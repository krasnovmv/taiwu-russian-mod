/**
 * Translation-memory persistence: one JSON file per source file under `tmDir`,
 * serialized deterministically (stable key order, 2-space indent, LF, trailing
 * newline) so git diffs stay clean and reviewable.
 */
import { readFile } from "node:fs/promises";
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
  return posix.replace(
    /^(Event_DLC\/[^/]+)\/[0-9]+(?:\.[0-9]+)*\/(.+)$/,
    "$1/$2",
  );
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

/** Persist the TM for a source file (creates nested dirs for tsv/json paths). */
export async function saveTm(tm: TmFile): Promise<void> {
  await writeFileAtomic(tmPathFor(tm.file), serializeTm(tm));
}
