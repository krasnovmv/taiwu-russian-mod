/**
 * Filesystem primitive for safe writing.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Atomically write `content` to `filePath`: create the parent directory, write a
 * sibling temp file, then rename over the target. Rename is atomic on the same
 * filesystem, so a reader never sees a half-written file. The temp file lives in
 * the target directory to keep the rename on one volume.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}
