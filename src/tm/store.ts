/**
 * Translation-memory persistence: one JSON file per source file under `tmDir`,
 * serialized deterministically (stable key order, 2-space indent, LF, trailing
 * newline) so git diffs stay clean and reviewable.
 */
import { readdir, readFile, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

import { tmDir } from "../config/paths.js";
import { EVENT_DLC_PREFIX } from "../config/sources.js";
import type { TmFile } from "../model/tm.js";
import { writeFileAtomic } from "../util/fs.js";

/**
 * The stable, version-independent key a source file's TM is stored under.
 *
 * DLC source ids carry the game version of the pack they came from
 * (`Event_DLC/<DLC>/<version>/Events/EventLanguages/<name>.txt`) because the
 * resolver needs it to find the EN/CN files on disk. The TM, however, should
 * live in ONE file per DLC pack so a new version updates the existing TM
 * instead of spawning a parallel copy — so we drop that version segment here.
 * All other ids pass through unchanged.
 */
export function tmKey(file: string): string {
  const posix = file.replace(/\\/g, "/");
  if (!posix.startsWith(EVENT_DLC_PREFIX)) return posix;
  // Strip the <version> segment: Event_DLC/<DLC>/<version>/<rest> → Event_DLC/<DLC>/<rest>.
  // Only when it looks like a dotted numeric version, so unexpected layouts are left intact.
  return posix.replace(/^(Event_DLC\/[^/]+)\/[0-9]+(?:\.[0-9]+)*\/(.+)$/, "$1/$2");
}

function tmPathFor(file: string): string {
  return path.join(tmDir, `${tmKey(file)}.json`);
}

/** Load the TM for a source file, or null if none exists yet. */
export async function loadTm(file: string): Promise<TmFile | null> {
  let raw: string;
  try {
    raw = await readFile(tmPathFor(file), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as TmFile;
}

/** Serialize a TM file to its canonical, diff-friendly JSON form. */
export function serializeTm(tm: TmFile): string {
  return `${JSON.stringify(tm, null, 2)}\n`;
}

/**
 * Thrown when a write would replace a populated TM with an empty one — always a
 * bug upstream (a source file that stopped parsing), never a real edit.
 */
export class EmptyTmOverwriteError extends Error {
  constructor(
    readonly tmFile: string,
    readonly lost: number,
  ) {
    super(
      `refusing to overwrite ${tmFile} (${lost} translated units) with an empty TM — ` +
        `the source file extracted zero units, which means it stopped parsing`,
    );
    this.name = "EmptyTmOverwriteError";
  }
}

/**
 * Pure: how many units writing `next` over the on-disk `current` would destroy
 * outright. Non-zero only for the one case no legitimate run produces — an empty
 * unit map replacing a populated one. Shrinking a TM by some units is normal
 * (keys come and go with the game), so only the total wipe is reported.
 */
export function emptyOverwriteLoss(current: string | null, next: TmFile): number {
  if (current === null || Object.keys(next.units).length > 0) return 0;
  return Object.keys((JSON.parse(current) as TmFile).units).length;
}

/**
 * Persist the TM for a source file (creates nested dirs for tsv/json paths).
 *
 * Skips the write when the serialized content is byte-identical to what's on
 * disk. Serialization is deterministic, so a rebuild that changes nothing (e.g.
 * every unit already up to date) touches no files — keeping git diffs limited to
 * what actually changed and avoiding pointless atomic rewrites of a 155 MB TM.
 *
 * Refuses outright to blank a populated TM. Losing every unit at once is not
 * something a translation run can legitimately do: keys disappear one at a time
 * as the game changes, and wholesale removal is `pruneOrphanTms`'s job. A file
 * that suddenly extracts nothing has stopped parsing instead — as 207 event
 * packages did when the 2026-07-22 update reflowed them to CRLF — and the write
 * would destroy work no one can recover from the cache.
 */
export async function saveTm(tm: TmFile): Promise<void> {
  const dest = tmPathFor(tm.file);
  const next = serializeTm(tm);
  let current: string | null = null;
  try {
    current = await readFile(dest, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (current === next) return;
  const lost = emptyOverwriteLoss(current, tm);
  if (lost > 0) throw new EmptyTmOverwriteError(tm.file, lost);
  await writeFileAtomic(dest, next);
}

/**
 * Recursively collect every stored TM key (each `<tmDir>/<key>.json` as its
 * `<key>`, in POSIX form). Returns `[]` when `tmDir` doesn't exist yet.
 */
async function listStoredTmKeys(dir: string = tmDir, rel = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await listStoredTmKeys(path.join(dir, e.name), childRel)));
    } else if (e.name.endsWith(".json")) {
      out.push(childRel.slice(0, -".json".length));
    }
  }
  return out;
}

/**
 * Pure: the stored TM keys with no backing source file. `sourceFiles` are the
 * current source ids; a stored key is an orphan when it isn't the {@link tmKey}
 * of any of them (the game file it translated was removed). Sorted for stable
 * reporting. Uses {@link tmKey} on both sides so DLC version bumps — which map
 * many source ids onto one version-independent TM key — never look orphaned.
 */
export function orphanTmKeys(stored: string[], sourceFiles: string[]): string[] {
  const valid = new Set(sourceFiles.map(tmKey));
  return stored.filter((key) => !valid.has(key)).sort();
}

/** Remove `dir` and any now-empty ancestors, stopping at (and never removing) `tmDir`. */
async function removeEmptyDirsUpTo(dir: string): Promise<void> {
  let current = dir;
  while (current !== tmDir && current.startsWith(tmDir)) {
    try {
      await rmdir(current); // throws ENOTEMPTY once a sibling TM remains
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * Delete every TM file whose source no longer exists and return the removed
 * keys. Pass the source list UNGATED and from BOTH languages (union of
 * `listAllSourceFiles` + `listCnSourceFiles`) so neither a disabled subsystem
 * nor a file that survives only in CN is mistaken for a deletion. With `dryRun`,
 * reports the orphans without touching disk. Empty dirs left behind are removed.
 */
export async function pruneOrphanTms(
  sourceFiles: string[],
  options: { dryRun?: boolean } = {},
): Promise<string[]> {
  const orphans = orphanTmKeys(await listStoredTmKeys(), sourceFiles);
  if (!options.dryRun) {
    for (const key of orphans) {
      const file = path.join(tmDir, `${key}.json`);
      await unlink(file);
      await removeEmptyDirsUpTo(path.dirname(file));
    }
  }
  return orphans;
}
