/**
 * Translation coverage report.
 *
 *   npm run status            # totals
 *   npm run status -- --files # per-file breakdown of unfinished files
 */
import { alignFile } from "../align/bilingual.js";
import { listSourceFiles } from "../scan.js";
import { computeCoverage, sumCoverage, type FileCoverage } from "../tm/coverage.js";
import { loadTm } from "../tm/store.js";
import { Progress } from "./progress.js";

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const showFiles = process.argv.includes("--files");
  const files = await listSourceFiles();

  const bar = new Progress(files.length, "status");
  const coverages: FileCoverage[] = [];
  for (const file of files) {
    const aligned = await alignFile(file);
    const tm = await loadTm(file);
    coverages.push(computeCoverage(aligned, tm));
    bar.increment(file);
  }
  bar.finish();

  const total = sumCoverage(coverages);

  console.log(`Source files (all formats): ${files.length}\n`);
  console.log(`Units total:      ${total.total.toLocaleString("en-US")}`);
  console.log(
    `  translated:     ${total.translated.toLocaleString("en-US")} (${pct(total.translated, total.total)})`,
  );
  console.log(`  stale (drift):  ${total.stale.toLocaleString("en-US")}`);
  console.log(
    `  pending:        ${total.pending.toLocaleString("en-US")} (${pct(total.pending, total.total)})`,
  );
  console.log(
    `  out of scope:   ${total.outOfScope.toLocaleString("en-US")} (over length cap; English kept)`,
  );
  console.log(`\nKeys EN-only (no CN reference): ${total.onlyEn.toLocaleString("en-US")}`);
  console.log(`Keys CN-only (no EN source):    ${total.onlyCn.toLocaleString("en-US")}`);

  if (showFiles) {
    const unfinished = coverages
      .filter((c) => c.pending + c.stale > 0)
      .sort((a, b) => b.pending + b.stale - (a.pending + a.stale));
    console.log(`\nUnfinished files (${unfinished.length}):`);
    for (const c of unfinished) {
      console.log(
        `  ${c.file}: ${c.translated}/${c.total} done, ${c.pending} pending` +
          (c.stale ? `, ${c.stale} stale` : ""),
      );
    }
  } else {
    console.log(`\n(run with --files for a per-file breakdown)`);
  }
}

await main();
