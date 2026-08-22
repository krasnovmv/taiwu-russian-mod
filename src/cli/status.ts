/**
 * Translation and judge coverage report.
 *
 *   npm run status            # totals
 *   npm run status -- --files # per-file breakdown: what is untranslated, and
 *                             # what still awaits the judge
 */
import { alignFile } from "../align/bilingual.js";
import { loadGlossary } from "../glossary/load.js";
import { judgeCoverage, type JudgeCoverage } from "../judge/judge.js";
import { listSourceFiles } from "../scan.js";
import { computeCoverage, sumCoverage, type FileCoverage } from "../tm/coverage.js";
import { makeSrcHasher } from "../tm/hash.js";
import { loadTm } from "../tm/store.js";
import { Progress } from "./progress.js";

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const showFiles = process.argv.includes("--files");
  const files = await listSourceFiles();

  const hashEn = makeSrcHasher(await loadGlossary());
  const bar = new Progress(files.length, "status");
  const coverages: FileCoverage[] = [];
  const judged: JudgeCoverage[] = [];
  for (const file of files) {
    const aligned = await alignFile(file);
    const tm = await loadTm(file);
    coverages.push(computeCoverage(aligned, tm, hashEn));
    // Reported under the source id, like coverage — the TM key is an artefact.
    if (tm) judged.push({ ...judgeCoverage(tm, hashEn), file });
    bar.increment(file);
  }
  bar.finish();

  const total = sumCoverage(coverages);
  const judgeTotal = judged.reduce(
    (a, j) => ({ judged: a.judged + j.judged, todo: a.todo + j.todo }),
    { judged: 0, todo: 0 },
  );

  console.log(`Source files (all formats): ${files.length}\n`);
  console.log(`Units total:      ${total.total.toLocaleString("en-US")}`);
  console.log(
    `  translated:     ${total.translated.toLocaleString("en-US")} (${pct(total.translated, total.total)})`,
  );
  console.log(`  stale (drift):  ${total.stale.toLocaleString("en-US")}`);
  console.log(
    `  pending:        ${total.pending.toLocaleString("en-US")} (${pct(total.pending, total.total)})`,
  );
  console.log(`\nKeys EN-only (no CN reference): ${total.onlyEn.toLocaleString("en-US")}`);
  console.log(`Keys CN-only (no EN source):    ${total.onlyCn.toLocaleString("en-US")}`);

  // What `npm run judge` still has ahead of it. Counted over the units it can
  // actually act on — a pending, human-curated, neutral or drifted unit is not
  // the judge's to review, so folding those in would understate the progress.
  const inScope = judgeTotal.judged + judgeTotal.todo;
  console.log(`\nJudge coverage (of ${inScope.toLocaleString("en-US")} reviewable units):`);
  console.log(
    `  reviewed:       ${judgeTotal.judged.toLocaleString("en-US")} (${pct(judgeTotal.judged, inScope)})`,
  );
  console.log(
    `  awaiting judge: ${judgeTotal.todo.toLocaleString("en-US")} (${pct(judgeTotal.todo, inScope)})`,
  );

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

    const unjudged = judged.filter((j) => j.todo > 0).sort((a, b) => b.todo - a.todo);
    console.log(`\nFiles awaiting the judge (${unjudged.length}):`);
    for (const j of unjudged) {
      console.log(
        `  ${j.file}: ${j.todo.toLocaleString("en-US")} unjudged of ` +
          `${(j.judged + j.todo).toLocaleString("en-US")} reviewable`,
      );
    }
  } else {
    console.log(`\n(run with --files for a per-file breakdown)`);
  }
}

await main();
