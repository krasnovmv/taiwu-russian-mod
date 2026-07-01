/**
 * Reconcile the translation memory with the current game files after an update.
 *
 *   npm run sync                 # reconcile all files that have a TM
 *   npm run sync -- --dry-run    # report only, write nothing
 *
 * Does not call the translation engine. After syncing, run `translate --all` to
 * fill new/drifted units, and `status` to see coverage. reviewed/locked units
 * are never overwritten — drift is reported so a human can review.
 */
import { listAllSourceFiles, listCnSourceFiles, listSourceFiles } from "../scan.js";
import { pruneOrphanTms } from "../tm/store.js";
import { syncFile } from "../tm/sync.js";
import { Progress } from "./progress.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const files = await listSourceFiles();

  const bar = new Progress(files.length, "sync");
  let reconciled = 0;
  let added = 0;
  let removed = 0;
  let driftedMachine = 0;
  let driftedReviewed = 0;
  const changes: string[] = [];

  for (const file of files) {
    const r = await syncFile(file, { dryRun });
    bar.increment(file);
    if (!r.hadTm) continue;
    reconciled++;
    added += r.added;
    removed += r.removed;
    driftedMachine += r.driftedMachine;
    driftedReviewed += r.driftedReviewed;
    if (r.added || r.removed || r.driftedMachine || r.driftedReviewed) {
      changes.push(
        `  ${file}: +${r.added} new, -${r.removed} removed, ` +
          `${r.driftedMachine} drifted, ${r.driftedReviewed} need review`,
      );
    }
  }
  bar.finish();

  // Whole-file cleanup: a game file that was removed leaves an orphaned TM the
  // per-file loop above never visits (it isn't in the source list). Prune those —
  // but only when the file is gone from BOTH EN and CN, so a file that still
  // exists in CN (or a broken Language_EN junction) never triggers a deletion.
  const [enSources, cnSources] = await Promise.all([listAllSourceFiles(), listCnSourceFiles()]);
  const orphans = await pruneOrphanTms([...enSources, ...cnSources], { dryRun });

  for (const c of changes) console.log(c);
  if (orphans.length) {
    console.log(`\nOrphaned TM files ${dryRun ? "(would remove)" : "removed"}:`);
    for (const o of orphans) console.log(`  - ${o}`);
  }
  console.log(`\nReconciled ${reconciled} file(s)${dryRun ? " (dry-run, nothing written)" : ""}`);
  console.log(`New keys (pending):        ${added}`);
  console.log(`Removed keys:              ${removed}`);
  console.log(`Orphaned TM files:         ${orphans.length}`);
  console.log(`Drifted machine (retranslate): ${driftedMachine}`);
  console.log(`Drifted reviewed/locked (review): ${driftedReviewed}`);
  if (driftedReviewed > 0) {
    console.log(
      `\n⚠ ${driftedReviewed} human-approved unit(s) have a changed source — review them.`,
    );
  }
}

await main();
