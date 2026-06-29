/** Filesystem helpers. */
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { delay } from "./async.js";

/** Windows AV/indexer transiently locks a freshly-written temp file; rename then
 * fails with one of these until the lock releases. Safe to retry. */
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_MAX_RETRIES = 10;

/**
 * Atomically write `content` to `filePath`: create the parent directory, write a
 * uniquely-named temp file in the same directory, then rename over the target.
 * Rename is atomic on one filesystem, so a reader never sees a partial file; the
 * pid-tagged temp name avoids collisions between concurrent writers.
 *
 * On Windows the rename can fail with EPERM/EACCES/EBUSY when antivirus or the
 * search indexer briefly holds the just-written temp file; retry with backoff
 * before giving up (and clean up the temp file on terminal failure).
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (attempt >= RENAME_MAX_RETRIES || !RENAME_RETRY_CODES.has(code)) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
      await delay(25 * (attempt + 1));
    }
  }
}
