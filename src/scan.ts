/**
 * Discovery of source language files across all formats.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { eventDlcDir, eventLanguagesDir, languageDir } from "./config/paths.js";
import { EVENT_DLC_PREFIX, EVENT_PREFIX } from "./config/sources.js";

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

/** Compare dotted numeric versions ("1.0.1.0" > "0.84.67.0"); longer wins ties. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function readDirNames(dir: string): Promise<string[] | null> {
  try {
    // Junctions/symlinks (the per-DLC links) report as reparse points, not
    // directories, so accept those too — readdir follows them when we recurse.
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Per-DLC quest packs under `Event_DLC/<DLC>/<version>/Events/EventLanguages`.
 * Each DLC keeps several versioned subfolders; only the NEWEST version that
 * actually carries EN text is used (older ones are CN-only stubs). Ids are full
 * repo-relative paths so {@link resolveSource} can find the CN/KO siblings.
 * Unlike the root quest folder, this is always on (the DLC corpus is small).
 */
export async function listDlcEventFiles(): Promise<string[]> {
  const dlcs = await readDirNames(eventDlcDir);
  if (!dlcs) return [];
  const out: string[] = [];
  for (const dlc of dlcs.sort()) {
    const versions = await readDirNames(path.join(eventDlcDir, dlc));
    if (!versions) continue;
    // Newest version first; take the first one that has EN package files.
    for (const ver of versions.sort(compareVersions).reverse()) {
      const langRel = `${dlc}/${ver}/Events/EventLanguages`;
      let names: string[];
      try {
        names = (await readdir(path.join(eventDlcDir, langRel), { withFileTypes: true }))
          .filter((e) => e.isFile() && e.name.endsWith("_Language_EN.txt"))
          .map((e) => e.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      if (names.length === 0) continue;
      for (const name of names.sort()) out.push(`${EVENT_DLC_PREFIX}${langRel}/${name}`);
      break; // newest version with EN content wins; ignore older ones
    }
  }
  return out;
}

/**
 * Whether the root `Event_Languages` quest text participates in the pipeline. It
 * is OFF by default (that corpus is large and translated separately); set
 * `TAIWU_EVENTS=1` to fold it back into discovery so `translate`/`apply`/
 * `status`/`estimate` pick it up. This gates ONLY the root folder — the DLC
 * quest packs ({@link listDlcEventFiles}) are always included.
 */
export function eventsEnabled(): boolean {
  const v = process.env.TAIWU_EVENTS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Every translatable source file (relative POSIX paths): all paired/anchored
 * `.txt`, the `.tsv` encyclopedia tables, the nested `.json` tips, the always-on
 * DLC quest packs, and — when {@link eventsEnabled} — the root `Event_Languages`
 * quest text. The adapter registry maps each to its format.
 */
export async function listSourceFiles(): Promise<string[]> {
  const [txt, tsv, json, events, dlc] = await Promise.all([
    listTxtFiles(),
    listUnder("EncyclopediaAssets", [".tsv"]),
    listUnder("CommonTip", [".json"]),
    eventsEnabled() ? listEventFiles() : Promise.resolve([]),
    listDlcEventFiles(),
  ]);
  return [...txt, ...tsv, ...json, ...events, ...dlc];
}
