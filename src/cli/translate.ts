/**
 * Translate pending units into the translation memory.
 *
 *   npm run translate -- <file> [--engine mock|yandex|lmstudio] [--limit N] [--dry-run]
 *   npm run translate -- --all   [--engine mock|yandex|lmstudio] [--limit N]
 *
 * Writes only the TM (tm/<file>.json), never the game files. Default engine is
 * `mock` (offline, free). `--engine yandex` needs TAIWU_YANDEX_* env vars;
 * `--engine lmstudio` talks to a local LM Studio server. `--all` is resumable:
 * TM is saved per file, so re-running skips already-translated units.
 */
import { createEngine, parseEngineId, type EngineId } from "../engine/factory.js";
import { listSourceFiles } from "../scan.js";
import { translateFile, type TranslateStats } from "../translate/pipeline.js";

function parseArgs(argv: string[]): {
  file: string | undefined;
  all: boolean;
  engine: EngineId;
  limit: number | undefined;
  dryRun: boolean;
} {
  let file: string | undefined;
  let all = false;
  let engine: EngineId = "mock";
  let limit: number | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--engine") engine = parseEngineId(argv[++i]);
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--all") all = true;
    else if (arg && !arg.startsWith("--")) file = arg;
  }
  return { file, all, engine, limit, dryRun };
}

function printStats(stats: TranslateStats, label: string): void {
  console.log(
    `  ${label}: ${stats.translated} translated, ${stats.skipped} skipped, ${stats.failed} failed`,
  );
}

async function main(): Promise<void> {
  const { file, all, engine: engineId, limit, dryRun } = parseArgs(process.argv.slice(2));
  if (!all && !file) {
    console.error(
      "Usage: npm run translate -- (<file> | --all) [--engine mock|yandex] [--limit N] [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  const engine = createEngine(engineId);
  const now = new Date().toISOString();
  const files = all ? await listSourceFiles() : [file as string];

  console.log(`Engine: ${engine.id}${dryRun ? " (dry-run)" : ""} | files: ${files.length}\n`);

  let translated = 0;
  let failed = 0;
  for (const f of files) {
    const stats = await translateFile(f, engine, { limit, dryRun, now });
    translated += stats.translated;
    failed += stats.failed;
    if (!all || stats.translated > 0 || stats.failed > 0) printStats(stats, f);
    if (stats.failures.length > 0 && !all) {
      for (const fail of stats.failures.slice(0, 20))
        console.log(`      ${fail.key}: ${fail.error}`);
    }
  }

  console.log(`\nTotal translated: ${translated}, failed: ${failed}`);
}

await main();
