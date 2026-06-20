/**
 * Translate one file's pending units into the translation memory.
 *
 *   npm run translate -- <file> [--engine mock|yandex] [--limit N] [--dry-run]
 *
 * Writes only the TM (tm/<file>.json), never the game files. Default engine is
 * `mock` (offline, free). Use `--engine yandex` with TAIWU_YANDEX_IAM_TOKEN and
 * TAIWU_YANDEX_FOLDER_ID set for real translation.
 */
import { createEngine, type EngineId } from "../engine/factory.js";
import { translateFile } from "../translate/pipeline.js";

function parseArgs(argv: string[]): {
  file: string | undefined;
  engine: EngineId;
  limit: number | undefined;
  dryRun: boolean;
} {
  let file: string | undefined;
  let engine: EngineId = "mock";
  let limit: number | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--engine") engine = argv[++i] === "yandex" ? "yandex" : "mock";
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg && !arg.startsWith("--")) file = arg;
  }
  return { file, engine, limit, dryRun };
}

async function main(): Promise<void> {
  const { file, engine: engineId, limit, dryRun } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error(
      "Usage: npm run translate -- <file> [--engine mock|yandex] [--limit N] [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  const engine = createEngine(engineId);
  const stats = await translateFile(file, engine, {
    limit,
    dryRun,
    now: new Date().toISOString(),
  });

  console.log(`File:        ${stats.file}`);
  console.log(`Engine:      ${engine.id}${dryRun ? " (dry-run, TM not written)" : ""}`);
  console.log(`Units:       ${stats.total}`);
  console.log(`Pending:     ${stats.pending}`);
  console.log(`Translated:  ${stats.translated}`);
  console.log(`Skipped:     ${stats.skipped}`);
  console.log(`Failed:      ${stats.failed}`);

  if (stats.failures.length > 0) {
    console.log(`\nFailures (markup validation):`);
    for (const f of stats.failures.slice(0, 20)) {
      console.log(`  ${f.key}: ${f.error}`);
    }
    if (stats.failures.length > 20) console.log(`  … and ${stats.failures.length - 20} more`);
  }
}

await main();
