/**
 * A cooperative single-writer lock for the commands that rewrite the TM.
 *
 * The TM is a tree of whole-file JSON writes, so two commands running at once do
 * not corrupt a file — they lose each other's units, the last writer winning per
 * flush. Worse, both talk to the same model backend: the judge's account pool is
 * capped at a few concurrent requests, and doubling the load on it is how a run
 * ends up with rate-limit errors and answers that do not match what was asked.
 *
 * So this is a guard against a SECOND run, not against concurrency inside one.
 * It is cooperative: it stops the honest mistake of launching twice, not a
 * determined caller.
 *
 * Staleness is decided by the recorded pid, not by a timeout: a judge run can sit
 * for many minutes on one slow batch, and any timeout long enough to be safe
 * would be too long to be useful. A lock whose process is gone is stale and taken
 * over; a lock whose process is alive is honoured however old it is.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "../config/paths.js";

export const LOCK_FILE = path.join(projectRoot, ".taiwu-write.lock");

interface LockRecord {
  pid: number;
  command: string;
  startedAt: string;
}

/** Whether a process is still around. `signal 0` tests without delivering one. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: gone. EPERM: exists but belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Take the lock for `command`, or throw if another live run holds it. Returns a
 * release function; call it in a `finally` so a failed run does not leave the
 * lock behind. A crash that skips it is fine — the next run sees a dead pid.
 */
export async function acquireWriteLock(command: string): Promise<() => Promise<void>> {
  const held = await readLock();
  if (held && held.pid !== process.pid && alive(held.pid)) {
    throw new Error(
      `another Taiwu run is writing: \`${held.command}\` (pid ${held.pid}, since ` +
        `${held.startedAt}). Wait for it, or delete ${LOCK_FILE} if you are sure it is gone.`,
    );
  }
  const record: LockRecord = {
    pid: process.pid,
    command,
    startedAt: new Date().toISOString(),
  };
  await writeFile(LOCK_FILE, JSON.stringify(record) + "\n", "utf8");

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    // Only drop the file if it is still OURS: a run that took over a stale lock
    // must not delete the lock of whoever took over from it.
    const current = await readLock();
    if (current?.pid === process.pid) await rm(LOCK_FILE, { force: true });
  };
}

async function readLock(): Promise<LockRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(LOCK_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Partial<LockRecord>;
    return typeof record.pid === "number"
      ? {
          pid: record.pid,
          command: record.command ?? "unknown",
          startedAt: record.startedAt ?? "unknown",
        }
      : null;
  } catch {
    // Absent, unreadable or torn: nothing to honour.
    return null;
  }
}
