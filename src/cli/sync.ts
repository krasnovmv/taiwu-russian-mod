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
import { listSourceFiles } from "../scan.js";
import { syncFile } from "../tm/sync.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const files = await listSourceFiles();

  let reconciled = 0;
  let added = 0;
  let removed = 0;
  let driftedMachine = 0;
  let driftedReviewed = 0;

  for (const file of files) {
    const r = await syncFile(file, { dryRun });
    if (!r.hadTm) continue;
    reconciled++;
    added += r.added;
    removed += r.removed;
    driftedMachine += r.driftedMachine;
    driftedReviewed += r.driftedReviewed;
    if (r.added || r.removed || r.driftedMachine || r.driftedReviewed) {
      console.log(
        `  ${file}: +${r.added} new, -${r.removed} removed, ` +
          `${r.driftedMachine} drifted, ${r.driftedReviewed} need review`,
      );
    }
  }

  console.log(`\nReconciled ${reconciled} file(s)${dryRun ? " (dry-run, nothing written)" : ""}`);
  console.log(`New keys (pending):        ${added}`);
  console.log(`Removed keys:              ${removed}`);
  console.log(`Drifted machine (retranslate): ${driftedMachine}`);
  console.log(`Drifted reviewed/locked (review): ${driftedReviewed}`);
  if (driftedReviewed > 0) {
    console.log(
      `\n⚠ ${driftedReviewed} human-approved unit(s) have a changed source — review them.`,
    );
  }
}

await main();
