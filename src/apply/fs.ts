/**
 * Filesystem primitives for safe in-place writing.
 */
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";

/**
 * Atomically write `content` to `filePath`: write a sibling temp file, then
 * rename over the target. Rename is atomic on the same filesystem, so a reader
 * never sees a half-written file. The temp file lives in the target directory
 * to guarantee the rename stays on one volume.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

/**
 * Copy `srcDir/file` into `backupDir/file` the first time only, preserving the
 * true pristine original across repeated apply runs. Returns true if a backup
 * was created, false if one already existed.
 */
export async function ensureBackup(
  file: string,
  srcDir: string,
  backupDir: string,
): Promise<boolean> {
  const dest = path.join(backupDir, file);
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    // COPYFILE_EXCL fails if the destination already exists — exactly the
    // "create once" semantics we want.
    await copyFile(path.join(srcDir, file), dest, FS.COPYFILE_EXCL);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}
