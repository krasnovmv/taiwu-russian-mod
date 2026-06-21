/**
 * Discovery of source language files across all formats.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { eventLanguagesDir, languageDir } from "./config/paths.js";
import { EVENT_PREFIX } from "./config/sources.js";

/** Top-level `.txt` files (the paired-txt format), sorted. */
export async function listTxtFiles(): Promise<string[]> {
  const entries = await readdir(languageDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".txt"))
    .map((e) => e.name)
    .sort();
}

async function walk(absDir: string, relDir: string, exts: string[]): Promise<string[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await walk(path.join(absDir, e.name), rel, exts)));
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(rel);
    }
  }
  return out;
}

async function listUnder(subdir: string, exts: string[]): Promise<string[]> {
  try {
    return (await walk(path.join(languageDir, subdir), subdir, exts)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Quest/event source files: the EN package files under `Event_Languages`
 * (`<package>_Language_EN.txt`), returned as ids prefixed with `EVENT_PREFIX`.
 * The CN reference and KO output siblings are not listed — they are resolved
 * from the EN id. Returns `[]` if the junction is absent.
 */
export async function listEventFiles(): Promise<string[]> {
  try {
    const entries = await readdir(eventLanguagesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith("_Language_EN.txt"))
      .map((e) => `${EVENT_PREFIX}${e.name}`)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Every translatable source file (relative POSIX paths): all paired/anchored
 * `.txt`, the `.tsv` encyclopedia tables, the nested `.json` tips, and the
 * `Event_Languages` quest text. The adapter registry maps each to its format.
 */
export async function listSourceFiles(): Promise<string[]> {
  const [txt, tsv, json, events] = await Promise.all([
    listTxtFiles(),
    listUnder("EncyclopediaAssets", [".tsv"]),
    listUnder("CommonTip", [".json"]),
    listEventFiles(),
  ]);
  return [...txt, ...tsv, ...json, ...events];
}
