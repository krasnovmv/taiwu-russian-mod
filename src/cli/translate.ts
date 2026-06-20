/**
 * Translate pending units into the translation memory.
 *
 *   npm run translate -- <file> [--engine mock|yandex|lmstudio] [--limit N] [--dry-run]
 *   npm run translate -- --all   [--engine mock|yandex|lmstudio] [--limit N]
 *   npm run translate -- --all --route [--threshold N] [--max-len N]
 *
 * Writes only the TM (tm/<file>.json), never the game files. Default engine is
 * `mock` (offline, free). `--engine yandex` needs TAIWU_YANDEX_* env vars;
 * `--engine lmstudio` talks to a local LM Studio server. `--all` is resumable:
 * TM is saved per file, so re-running skips already-translated units.
 *
 * `--route` ignores `--engine` and routes by source length: units up to
 * `--threshold` (default ROUTING_THRESHOLD) go to Yandex, longer ones to LM
 * Studio. With `--max-len N`, units longer than N are skipped entirely (English
 * kept) — e.g. `--route --threshold 20 --max-len 40`: ≤20 Yandex, 21–40 LM
 * Studio, >40 skipped. `--min-len`/`--max-len` also window a single-engine run.
 */
import { ROUTING_THRESHOLD } from "../config/translate.js";
import { createEngine, parseEngineId, type EngineId } from "../engine/factory.js";
import type { TranslationEngine } from "../engine/types.js";
import { listSourceFiles } from "../scan.js";
import { translateFile } from "../translate/pipeline.js";
import { FileProgress } from "./progress.js";

interface Args {
  file: string | undefined;
  all: boolean;
  engine: EngineId;
  limit: number | undefined;
  dryRun: boolean;
  route: boolean;
  threshold: number | undefined;
  minLen: number | undefined;
  maxLen: number | undefined;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    file: undefined,
    all: false,
    engine: "mock",
    limit: undefined,
    dryRun: false,
    route: false,
    threshold: undefined,
    minLen: undefined,
    maxLen: undefined,
  };
  const num = (v: string | undefined): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--engine") {
      const value = argv[++i];
      a.engine = parseEngineId(value);
      if (value !== undefined && value !== a.engine) {
        console.error(`Unknown engine "${value}"; falling back to "${a.engine}".`);
      }
    } else if (arg === "--limit") a.limit = num(argv[++i]);
    else if (arg === "--threshold") a.threshold = num(argv[++i]);
    else if (arg === "--min-len") a.minLen = num(argv[++i]);
    else if (arg === "--max-len") a.maxLen = num(argv[++i]);
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--route") a.route = true;
    else if (arg === "--all") a.all = true;
    else if (arg && !arg.startsWith("--")) a.file = arg;
  }
  return a;
}

interface PassResult {
  translated: number;
  failed: number;
  failures: { key: string; error: string }[];
}

/** Translate `files` with one engine, within an optional length window. */
async function runPass(
  files: string[],
  engine: TranslationEngine,
  opts: { limit?: number; dryRun?: boolean; now: string; minLen?: number; maxLen?: number },
  label: string,
): Promise<PassResult> {
  console.log(label);
  const bars = new FileProgress(files.length);
  const out: PassResult = { translated: 0, failed: 0, failures: [] };
  for (const f of files) {
    const stats = await translateFile(f, engine, {
      limit: opts.limit,
      dryRun: opts.dryRun,
      now: opts.now,
      minLen: opts.minLen,
      maxLen: opts.maxLen,
      onStart: (totalUnits) => bars.startFile(f, totalUnits),
      onProgress: (done) => bars.unit(done),
    });
    out.translated += stats.translated;
    out.failed += stats.failed;
    out.failures.push(...stats.failures);
    bars.finishFile();
  }
  bars.stop();
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.all && !args.file) {
    console.error(
      "Usage: npm run translate -- (<file> | --all) [--engine mock|yandex|lmstudio]\n" +
        "       [--limit N] [--dry-run] [--min-len N] [--max-len N]\n" +
        "       npm run translate -- --all --route [--threshold N]",
    );
    process.exitCode = 1;
    return;
  }

  const now = new Date().toISOString();
  const files = args.all ? await listSourceFiles() : [args.file as string];
  const suffix = args.dryRun ? " (dry-run)" : "";
  const passes: PassResult[] = [];

  if (args.route) {
    // Length-routed: Yandex for short units, LM Studio for mid-length ones, and
    // (with --max-len) skip anything longer so a one-off run isn't held up by the
    // slow LLM on the longest prose — those stay untranslated (English on apply).
    const t = args.threshold ?? ROUTING_THRESHOLD;
    const cap = args.maxLen; // optional upper bound; units longer than this are skipped
    const [yandex, lmstudio] = await Promise.all([
      createEngine("yandex"),
      createEngine("lmstudio"),
    ]);
    const capNote = cap !== undefined ? ` | skip > ${cap}` : "";
    console.log(`Route${suffix} | files: ${files.length} | Yandex ≤${t} < LM Studio${capNote}`);
    passes.push(
      await runPass(
        files,
        yandex,
        { dryRun: args.dryRun, now, maxLen: t },
        `\nPass 1/2 — Yandex (≤ ${t} chars)`,
      ),
    );
    const lmRange = cap !== undefined ? `${t + 1}–${cap}` : `> ${t}`;
    passes.push(
      await runPass(
        files,
        lmstudio,
        { dryRun: args.dryRun, now, minLen: t + 1, maxLen: cap },
        `\nPass 2/2 — LM Studio (${lmRange} chars)`,
      ),
    );
  } else {
    const engine = await createEngine(args.engine);
    const window =
      args.minLen !== undefined || args.maxLen !== undefined
        ? ` | len ${args.minLen ?? 0}..${args.maxLen ?? "∞"}`
        : "";
    passes.push(
      await runPass(
        files,
        engine,
        { limit: args.limit, dryRun: args.dryRun, now, minLen: args.minLen, maxLen: args.maxLen },
        `Engine: ${engine.id}${suffix} | files: ${files.length}${window}`,
      ),
    );
  }

  const translated = passes.reduce((n, p) => n + p.translated, 0);
  const failed = passes.reduce((n, p) => n + p.failed, 0);
  const failures = passes.flatMap((p) => p.failures);

  console.log(`\nTotal translated: ${translated}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`\nMarkup-validation failures (${failures.length}):`);
    for (const fail of failures.slice(0, 20)) console.log(`  ${fail.key}: ${fail.error}`);
    if (failures.length > 20) console.log(`  … and ${failures.length - 20} more`);
  }
}

await main();
