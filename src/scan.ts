/**
 * Discovery of source language files across all formats.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  eventDlcDir,
  eventLanguagesDir,
  languageCnDir,
  languageDir,
  projectRoot,
} from "./config/paths.js";
import { BUNDLE_OPTIONTIPS_PREFIX, EVENT_DLC_PREFIX, EVENT_PREFIX } from "./config/sources.js";

/** Top-level `.txt` files (the paired-txt format) under `base`, sorted; `[]` if `base` is absent. */
async function txtFilesIn(base: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".txt"))
    .map((e) => e.name)
    .sort();
}

/** Top-level `.txt` files (the paired-txt format) in the EN pack, sorted. */
export function listTxtFiles(): Promise<string[]> {
  return txtFilesIn(languageDir);
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

async function listUnder(subdir: string, exts: string[], base: string = languageDir): Promise<string[]> {
  try {
    return (await walk(path.join(base, subdir), subdir, exts)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * The EN-style id of an event package file discovered under an arbitrary language
 * suffix: strip the suffix and re-append `_Language_EN.txt`. TM ids are always
 * keyed off the EN filename, so a CN sibling (`X_Language_CN.txt`) must normalize
 * back to `X_Language_EN.txt` to line up with the stored TM.
 */
function enEventName(name: string, suffix: string): string {
  return `${name.slice(0, -suffix.length)}_Language_EN.txt`;
}

/**
 * Quest/event source files: the EN package files under `Event_Languages`
 * (`<package>_Language_EN.txt`), returned as ids prefixed with `EVENT_PREFIX`.
 * The CN reference and KO output siblings are not listed — they are resolved
 * from the EN id. Returns `[]` if the junction is absent.
 */
export function listEventFiles(): Promise<string[]> {
  return eventFilesWithSuffix("_Language_EN.txt");
}

/** Root quest packs carrying a `<suffix>` file, returned as EN-normalized ids. */
async function eventFilesWithSuffix(suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(eventLanguagesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(suffix))
      .map((e) => `${EVENT_PREFIX}${enEventName(e.name, suffix)}`)
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
export function listDlcEventFiles(): Promise<string[]> {
  return dlcEventFilesWithSuffix("_Language_EN.txt");
}

/**
 * DLC quest packs carrying a `<suffix>` file, returned as EN-normalized ids (the
 * newest version WITH such content wins per DLC). EN uses `_Language_EN.txt`; a
 * CN pass uses `_Language_CN.txt` and the ids still come out EN-keyed so they
 * line up with the version-independent TM key.
 */
async function dlcEventFilesWithSuffix(suffix: string): Promise<string[]> {
  const dlcs = await readDirNames(eventDlcDir);
  if (!dlcs) return [];
  const out: string[] = [];
  for (const dlc of dlcs.sort()) {
    const versions = await readDirNames(path.join(eventDlcDir, dlc));
    if (!versions) continue;
    // Newest version first; take the first one that has package files for this suffix.
    for (const ver of versions.sort(compareVersions).reverse()) {
      const langRel = `${dlc}/${ver}/Events/EventLanguages`;
      let names: string[];
      try {
        names = (await readdir(path.join(eventDlcDir, langRel), { withFileTypes: true }))
          .filter((e) => e.isFile() && e.name.endsWith(suffix))
          .map((e) => e.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      if (names.length === 0) continue;
      for (const name of names.sort())
        out.push(`${EVENT_DLC_PREFIX}${langRel}/${enEventName(name, suffix)}`);
      break; // newest version with content wins; ignore older ones
    }
  }
  return out;
}

/**
 * The bundled EventOptionTips source, if it has been extracted into the repo
 * (`tools/extract-option-tips.py`). A single-file family; returns `[]` if absent.
 */
export function listOptionTipsFiles(): Promise<string[]> {
  return optionTipsFilesWithSuffix("_EN.txt");
}

/** The bundled EventOptionTips id if its `<suffix>` file exists; always the EN-keyed id. */
async function optionTipsFilesWithSuffix(suffix: string): Promise<string[]> {
  const enId = `${BUNDLE_OPTIONTIPS_PREFIX}EventOptionTips_EN.txt`;
  const probe = `${BUNDLE_OPTIONTIPS_PREFIX}EventOptionTips${suffix}`;
  try {
    await stat(path.join(projectRoot, probe));
    return [enId];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
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

async function discover(includeRootEvents: boolean): Promise<string[]> {
  const [txt, tsv, json, events, dlc, optionTips] = await Promise.all([
    listTxtFiles(),
    listUnder("EncyclopediaAssets", [".tsv"]),
    listUnder("CommonTip", [".json"]),
    includeRootEvents ? listEventFiles() : Promise.resolve([]),
    listDlcEventFiles(),
    listOptionTipsFiles(),
  ]);
  // A healthy install has ~225 top-level .txt files, so zero means the
  // Language_EN junction is missing or dangling — a fresh clone or a new git
  // worktree (they are all gitignored). Every per-family lister above degrades
  // softly (`[]`) because ANY ONE family may legitimately be absent; the whole
  // corpus vanishing is different, and quietly returning [] here once read as
  // "nothing to do" through the entire pipeline (rebuild-tm processed 0 files).
  if (txt.length === 0) {
    throw new Error(
      `no source files found: ${languageDir} is missing or empty — ` +
        "recreate the gitignored junctions (tools/setup-junctions.ps1; " +
        'see "Fresh machine" in README.md)',
    );
  }
  return [...txt, ...tsv, ...json, ...events, ...dlc, ...optionTips];
}

/**
 * Every translatable source file (relative POSIX paths): all paired/anchored
 * `.txt`, the `.tsv` encyclopedia tables, the nested `.json` tips, the always-on
 * DLC quest packs, and — when {@link eventsEnabled} — the root `Event_Languages`
 * quest text. The adapter registry maps each to its format.
 */
export function listSourceFiles(): Promise<string[]> {
  return discover(eventsEnabled());
}

/**
 * Like {@link listSourceFiles} but IGNORES the `TAIWU_EVENTS` gate, always
 * including the root `Event_Languages` quest text. Use this ONLY for orphan-TM
 * pruning: a TM must count as "still backed by a source" whenever its game file
 * exists on disk, regardless of whether this run happens to translate it — else
 * a run with events disabled would look like every root-quest file was deleted
 * and wrongly prune all their TMs.
 */
export function listAllSourceFiles(): Promise<string[]> {
  return discover(true);
}

/**
 * The same source ids as {@link listAllSourceFiles} but discovered from the CN
 * tree (`Language_CN` and the `_Language_CN` / `_CN` siblings), normalized back
 * to their EN-style ids. Orphan-TM pruning keeps a TM if its file survives in
 * EITHER language, so a file removed from EN but still present in CN — or a
 * momentarily broken `Language_EN` junction — is never mistaken for a deletion.
 */
export async function listCnSourceFiles(): Promise<string[]> {
  const [txt, tsv, json, events, dlc, optionTips] = await Promise.all([
    txtFilesIn(languageCnDir),
    listUnder("EncyclopediaAssets", [".tsv"], languageCnDir),
    listUnder("CommonTip", [".json"], languageCnDir),
    eventFilesWithSuffix("_Language_CN.txt"),
    dlcEventFilesWithSuffix("_Language_CN.txt"),
    optionTipsFilesWithSuffix("_CN.txt"),
  ]);
  return [...txt, ...tsv, ...json, ...events, ...dlc, ...optionTips];
}
