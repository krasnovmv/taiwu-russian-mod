/**
 * Translation-memory persistence: one JSON file per source file under `tmDir`,
 * serialized deterministically (stable key order, 2-space indent, LF, trailing
 * newline) so git diffs stay clean and reviewable.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { tmDir } from "../config/paths.js";
import type { TmFile } from "../model/tm.js";

function tmPathFor(file: string): string {
  return path.join(tmDir, `${file}.json`);
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
  const dest = tmPathFor(tm.file);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, serializeTm(tm), "utf8");
}
