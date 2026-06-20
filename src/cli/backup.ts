/**
 * Back up / restore the game's original `Language_EN` folder.
 *
 *   npm run backup            # copy <game>/Language_EN  -> <game>/Language_EN_backup
 *   npm run backup -- --force # overwrite an existing backup
 *   npm run restore           # copy <game>/Language_EN_backup -> <game>/Language_EN
 *
 * Operates on the REAL game folder: `Language_EN` in the repo is a junction into
 * the game's `StreamingAssets`, so the backup is created right next to the
 * original (in the game folder), and restore copies it back over `Language_EN`.
 *
 * Safety: `backup` refuses to overwrite an existing backup (so a pristine copy is
 * never clobbered by an already-modified one) unless `--force`.
 */
import { cp, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { languageDir } from "../config/paths.js";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) n++;
  }
  return n;
}

async function main(): Promise<void> {
  const restore = process.argv.includes("--restore");
  const force = process.argv.includes("--force");

  // Resolve the real game folder (Language_EN may be a junction into the game).
  let original: string;
  try {
    original = await realpath(languageDir);
  } catch {
    console.error(`Language_EN not found at ${languageDir}`);
    process.exitCode = 1;
    return;
  }
  const backup = path.join(path.dirname(original), "Language_EN_backup");

  if (restore) {
    if (!(await exists(backup))) {
      console.error(`No backup at ${backup} — nothing to restore.`);
      process.exitCode = 1;
      return;
    }
    await cp(backup, original, { recursive: true, force: true });
    console.log(`Restored ${await countFiles(original)} files\n  ${backup}\n  -> ${original}`);
    return;
  }

  if ((await exists(backup)) && !force) {
    console.error(
      `Backup already exists at\n  ${backup}\nRefusing to overwrite a pristine copy. Use --force to replace it.`,
    );
    process.exitCode = 1;
    return;
  }
  await cp(original, backup, { recursive: true, force: true });
  console.log(`Backed up ${await countFiles(backup)} files\n  ${original}\n  -> ${backup}`);
}

await main();
