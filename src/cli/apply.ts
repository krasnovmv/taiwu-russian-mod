/**
 * Apply the translation memory into the EN language files, in place.
 *
 *   npm run apply -- --dry-run          # preview, write nothing (default-safe)
 *   npm run apply -- <file>             # one file
 *   npm run apply -- --all              # every translatable file
 *
 * In-place writing modifies the actual game files (via the Language_EN
 * junction). Originals are backed up once to backups/ before the first write,
 * and writes are atomic with a structural guard. A bare run with no target is
 * treated as a dry-run to avoid accidental writes.
 */
import { applyFile } from "../apply/apply.js";
import { listSourceFiles } from "../scan.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((a) => !a.startsWith("--"));

  if (!all && !fileArg) {
    console.error("Usage: npm run apply -- (<file> | --all) [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const files = all ? await listSourceFiles() : [fileArg as string];

  let written = 0;
  let appliedTotal = 0;
  let unsafeTotal = 0;
  const blocked: string[] = [];

  for (const file of files) {
    const r = await applyFile(file, { dryRun });
    appliedTotal += r.applied;
    unsafeTotal += r.unsafe;
    if (r.written) {
      written++;
      console.log(`  ✓ ${file}: ${r.applied} values written`);
    } else if (r.reason && r.reason.startsWith("structural guard")) {
      blocked.push(`${file}: ${r.reason}`);
      console.error(`  ✗ ${file}: ${r.reason}`);
    } else if (r.applied > 0) {
      console.log(`  ~ ${file}: ${r.applied} ready (${r.reason})`);
    }
  }

  console.log(`\nFiles written: ${written}`);
  console.log(`Values applied: ${appliedTotal}`);
  if (unsafeTotal > 0) console.log(`Unsafe (newline in RU, skipped): ${unsafeTotal}`);
  if (blocked.length > 0) {
    console.error(`\nBlocked by structural guard: ${blocked.length} (nothing written for these)`);
    process.exitCode = 1;
  }
  if (dryRun) console.log(`\n(dry-run: no files were modified)`);
}

await main();
