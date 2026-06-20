/** Filesystem helpers. */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Atomically write `content` to `filePath`: create the parent directory, write a
 * uniquely-named temp file in the same directory, then rename over the target.
 * Rename is atomic on one filesystem, so a reader never sees a partial file; the
 * pid-tagged temp name avoids collisions between concurrent writers.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}
