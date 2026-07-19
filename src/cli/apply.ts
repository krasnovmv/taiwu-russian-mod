/**
 * Build the Russian language pack from the translation memory.
 *
 *   npm run apply -- --all              # every file -> Language_RU
 *   npm run apply -- <file>             # one file
 *   npm run apply -- --all --dry-run    # preview, write nothing
 *
 * Writes into `Language_RU` (mirroring the source layout); the original
 * `Language_EN` is never modified. Untranslated text stays English, so the
 * output is a complete, loadable language folder. Re-run any time — it is
 * idempotent and overwrites the output.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { applyFile } from "../apply/apply.js";
import { imageSrcDir, languageRuDir } from "../config/paths.js";
import { listSourceFiles } from "../scan.js";
import { Progress } from "./progress.js";

/**
 * A localized sprite carries a `_ru` language token, which may sit at the end of the name
 * (`..._ru.png`) or in front of an atlas index (`..._ru_3.png`, `..._0_ru.png`). Everything else in
 * {@link imageSrcDir} is mod art rather than a sprite — `logo.jpg` ships in the mod root — and the
 * frontend could never load it from here, since it resolves `Language_RU/Images/<name>_ru.png`.
 */
const ruSpriteName = /_ru(_|\.)/i;

/** Copy hand-translated RU UI images from {@link imageSrcDir} into the pack's Images/ folder. */
function deployImages(): number {
  if (!existsSync(imageSrcDir)) return 0;
  const dst = path.join(languageRuDir(), "Images");
  mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const f of readdirSync(imageSrcDir)) {
    if (!f.toLowerCase().endsWith(".png")) continue;
    if (!ruSpriteName.test(f)) continue;
    cpSync(path.join(imageSrcDir, f), path.join(dst, f));
    n++;
  }
  return n;
}

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
  console.log(`Output: ${languageRuDir()}${dryRun ? " (dry-run)" : ""}`);

  const bar = new Progress(files.length, "apply");
  let written = 0;
  let appliedTotal = 0;
  let unsafeTotal = 0;
  const blocked: string[] = [];

  for (const file of files) {
    const r = await applyFile(file, { dryRun });
    appliedTotal += r.applied;
    unsafeTotal += r.unsafe;
    if (r.written) written++;
    else if (r.reason?.startsWith("structural guard")) blocked.push(`${file}: ${r.reason}`);
    bar.increment(file);
  }
  bar.finish();

  if (all && !dryRun) {
    const images = deployImages();
    if (images > 0) console.log(`Images deployed: ${images}`);
  }

  for (const b of blocked) console.error(`  ✗ ${b}`);
  console.log(`Files written:  ${written}`);
  console.log(`Values applied: ${appliedTotal}`);
  if (unsafeTotal > 0) console.log(`Unsafe (skipped): ${unsafeTotal}`);
  if (blocked.length > 0) {
    console.error(`\nBlocked by structural guard: ${blocked.length}`);
    process.exitCode = 1;
  }
  if (dryRun) console.log(`\n(dry-run: nothing written)`);
}

await main();
