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
import { translateFile } from "../translate/pipeline.js";
import { FileProgress } from "./progress.js";

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
    if (arg === "--engine") {
      const value = argv[++i];
      engine = parseEngineId(value);
      if (value !== undefined && value !== engine) {
        console.error(`Unknown engine "${value}"; falling back to "${engine}".`);
      }
    } else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--all") all = true;
    else if (arg && !arg.startsWith("--")) file = arg;
  }
  return { file, all, engine, limit, dryRun };
}

async function main(): Promise<void> {
  const { file, all, engine: engineId, limit, dryRun } = parseArgs(process.argv.slice(2));
  if (!all && !file) {
    console.error(
      "Usage: npm run translate -- (<file> | --all) [--engine mock|yandex|lmstudio] [--limit N] [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  const engine = await createEngine(engineId);
  const now = new Date().toISOString();
  const files = all ? await listSourceFiles() : [file as string];

  console.log(`Engine: ${engine.id}${dryRun ? " (dry-run)" : ""} | files: ${files.length}`);

  const bars = new FileProgress(files.length);
  let translated = 0;
  let failed = 0;
  const failures: { key: string; error: string }[] = [];
  for (const f of files) {
    const stats = await translateFile(f, engine, {
      limit,
      dryRun,
      now,
      onStart: (totalUnits) => bars.startFile(f, totalUnits),
      onProgress: (done) => bars.unit(done),
    });
    translated += stats.translated;
    failed += stats.failed;
    failures.push(...stats.failures);
    bars.finishFile();
  }
  bars.stop();

  console.log(`Total translated: ${translated}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`\nMarkup-validation failures (${failures.length}):`);
    for (const fail of failures.slice(0, 20)) console.log(`  ${fail.key}: ${fail.error}`);
    if (failures.length > 20) console.log(`  … and ${failures.length - 20} more`);
  }
}

await main();
