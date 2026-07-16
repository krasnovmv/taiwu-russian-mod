/**
 * LLM judge: review the machine translations in the TM and fix the bad ones.
 *
 *   npm run judge -- --all                  # every file, every unjudged unit
 *   npm run judge -- <file>                 # one file
 *   npm run judge -- --all --limit 50       # sample (per file)
 *   npm run judge -- --all --min-len 40     # only the long prose
 *   npm run judge -- --all --dry-run        # report the fixes, write nothing
 *   npm run judge -- --all --force          # re-judge units that already have a verdict
 *
 * Backend is chosen by TAIWU_JUDGE_ENGINE: Yandex AI Studio (default;
 * TAIWU_YANDEX_API_KEY / TAIWU_YANDEX_FOLDER_ID, billed per token) or a local LM
 * Studio server (`=lmstudio`; TAIWU_LMSTUDIO_BASE_URL/MODEL, free GPU time).
 * TAIWU_JUDGE_MODEL or --model picks the model on either. Each unit is shown to
 * the model with its file, key, English source, Chinese original and glossary
 * terms; a unit ruled wrong is rewritten in place in the TM (`status: "judged"`).
 * Resumable: a verdict is remembered per unit and only replayed when the EN, CN
 * or glossary behind it changes (see config/judge.ts). Units with an identical
 * review context (same EN/CN and engine) share ONE request — the verdict fans
 * out to every duplicate across files, and is persisted in cache/judge.jsonl so
 * later runs replay it for free (see `verdictKey` in judge/judge.ts).
 *
 * Nothing reaches the game until `npm run apply-all`.
 */
import { JUDGE_CONCURRENCY, JUDGE_ENGINE } from "../config/judge.js";
import { EVENT_DLC_PREFIX, EVENT_PREFIX } from "../config/sources.js";
import { LmStudioClient } from "../engine/lmstudio-client.js";
import { YandexGptClient } from "../engine/yandex-gpt-client.js";
import {
  judgeFile,
  planJudgeFile,
  type JudgeMemo,
  type JudgeOutcome,
  type JudgeStats,
} from "../judge/judge.js";
import { VerdictCache } from "../judge/verdict-cache.js";
import { listSourceFiles } from "../scan.js";
import { FileProgress, Progress } from "./progress.js";

interface Args {
  file: string | undefined;
  all: boolean;
  limit: number | undefined;
  minLen: number | undefined;
  maxLen: number | undefined;
  concurrency: number | undefined;
  model: string | undefined;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    file: undefined,
    all: false,
    limit: undefined,
    minLen: undefined,
    maxLen: undefined,
    concurrency: undefined,
    model: undefined,
    force: false,
    dryRun: false,
  };
  const num = (v: string | undefined): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") a.limit = num(argv[++i]);
    else if (arg === "--min-len") a.minLen = num(argv[++i]);
    else if (arg === "--max-len") a.maxLen = num(argv[++i]);
    else if (arg === "--concurrency") a.concurrency = num(argv[++i]);
    else if (arg === "--model") a.model = argv[++i];
    else if (arg === "--force") a.force = true;
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--all") a.all = true;
    else if (arg && !arg.startsWith("--")) a.file = arg;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.all && !args.file) {
    console.error(
      "Usage: npm run judge -- (<file> | --all) [--limit N] [--min-len N] [--max-len N]\n" +
        "       [--concurrency N] [--model ID] [--force] [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  // TEMPORARY: quest text and the encyclopedia tables are out of the judge queue
  // for now — drop this filter to fold them back in. An explicit <file> argument
  // still bypasses it.
  const skipForNow = (f: string): boolean =>
    f.startsWith(EVENT_PREFIX) || f.startsWith(EVENT_DLC_PREFIX) || f.endsWith(".tsv");
  const files = args.all
    ? (await listSourceFiles()).filter((f) => !skipForNow(f))
    : [args.file as string];
  const client =
    JUDGE_ENGINE === "lmstudio"
      ? LmStudioClient.fromEnv(args.model)
      : YandexGptClient.fromEnv(args.model);
  const model = await client.ensureModel(); // fail fast if the backend is unreachable
  const now = new Date().toISOString();
  const select = {
    limit: args.limit,
    minLen: args.minLen,
    maxLen: args.maxLen,
    force: args.force,
  };

  const window =
    args.minLen !== undefined || args.maxLen !== undefined
      ? ` | len ${args.minLen ?? 0}..${args.maxLen ?? "∞"}`
      : "";
  const suffix = args.dryRun ? " (dry-run)" : "";
  const concurrency = args.concurrency ?? JUDGE_CONCURRENCY;
  console.log(
    `Judge${suffix} | engine: ${JUDGE_ENGINE} | model: ${model} | files: ${files.length} | ` +
      `concurrency: ${concurrency}${window}` +
      (args.force ? " | force" : ""),
  );

  // Plan first, so the unit bar shows one global total instead of resetting per file.
  const plan = new Progress(files.length, "plan");
  const planned = new Map<string, number>();
  for (const file of files) {
    planned.set(file, await planJudgeFile(file, select));
    plan.increment(file);
  }
  plan.finish();
  const grandTotal = [...planned.values()].reduce((a, b) => a + b, 0);
  // Judge the smallest files first: whole files finish (and land in the TM) early,
  // so an interrupted run leaves the most files fully judged.
  files.sort((a, b) => (planned.get(a) ?? 0) - (planned.get(b) ?? 0) || a.localeCompare(b));
  console.log(`\nUnits to judge: ${grandTotal}`);

  const bars = new FileProgress(files.length, grandTotal);
  const all: JudgeStats[] = [];
  // One memo for the whole run: a (EN, CN, engine) context judged once settles
  // its duplicates in every later file without another request. The disk-backed
  // cache (cache/judge.jsonl) extends the reuse across runs; a dry run must not
  // write anything, so it gets a throwaway in-memory map instead.
  const memo: JudgeMemo = args.dryRun ? new Map<string, JudgeOutcome>() : await VerdictCache.open();
  let base = 0; // units judged in the already-finished files
  for (const file of files) {
    let fileTotal = 0;
    const stats = await judgeFile(file, client, {
      ...select,
      dryRun: args.dryRun,
      now,
      concurrency: args.concurrency,
      memo,
      onStart: (total) => {
        fileTotal = total;
        bars.startFile(file);
      },
      onProgress: (done) => bars.unit(base + done),
    });
    base += fileTotal;
    all.push(stats);
    bars.finishFile();
  }
  bars.stop();

  const sum = (pick: (s: JudgeStats) => number): number => all.reduce((n, s) => n + pick(s), 0);
  const fixes = all.flatMap((s) => s.fixes.map((f) => ({ ...f, file: s.file })));
  const problems = all.flatMap((s) => s.problems.map((p) => ({ ...p, file: s.file })));

  console.log(
    `\nJudged: ${sum((s) => s.judged)} | kept: ${sum((s) => s.ok)} (minor-only: ${sum(
      (s) => s.minorOnly,
    )}) | fixed: ${sum((s) => s.fixed)} | rejected by QA: ${sum(
      (s) => s.rejected,
    )} | reused (duplicates): ${sum((s) => s.reused)} | errors: ${sum((s) => s.errors)}${suffix}`,
  );

  if (fixes.length > 0) {
    console.log(`\nFixes (${fixes.length}):`);
    for (const f of fixes.slice(0, 15)) {
      console.log(`  ${f.file} ${f.key}${f.note ? ` — ${f.note}` : ""}`);
      console.log(`    - ${f.before}`);
      console.log(`    + ${f.after}`);
    }
    if (fixes.length > 15) console.log(`  … and ${fixes.length - 15} more`);
  }
  if (problems.length > 0) {
    console.log(`\nProblems (${problems.length}, left unjudged for a later run):`);
    for (const p of problems.slice(0, 15)) console.log(`  ${p.file} ${p.key}: ${p.error}`);
    if (problems.length > 15) console.log(`  … and ${problems.length - 15} more`);
  }
}

await main();
