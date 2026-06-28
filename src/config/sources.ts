/**
 * Map a source-file id (the stable, repo-relative POSIX path the pipeline and TM
 * use) to the concrete EN / CN / output files on disk.
 *
 * Three source families share the pipeline:
 *
 *  - The `Language_*` packs (the default): a file id is the path RELATIVE to
 *    `Language_EN`; the CN reference and RU output sit at the SAME relative path
 *    under sibling directories (`Language_CN`, `Language_KO`).
 *
 *  - The quest/event text under `Event_Languages` (the game-root `Event` folder,
 *    outside StreamingAssets) and the per-DLC quest packs under `Event_DLC`. For
 *    both, the file id IS the repo-relative path, and EN/CN/output all live in
 *    ONE directory differing only by the `_Language_XX` filename suffix — so the
 *    resolver swaps `EN` → `CN` / `KO` in the name rather than the directory.
 *
 * Centralising this here keeps `align` and `apply` from hard-coding either
 * layout, and makes each event family a pure addition.
 */
import path from "node:path";

import { realpathSync } from "node:fs";

import {
  eventOptionTipsOutDir,
  languageCnDir,
  languageDir,
  languageRuDir,
  mirrorToOutput,
  outLang,
  outputDir,
  projectRoot,
} from "./paths.js";

/** Id prefix for the root quest folder (gated behind `TAIWU_EVENTS`). */
export const EVENT_PREFIX = "Event_Languages/";
/** Id prefix for the always-on per-DLC quest packs. */
export const EVENT_DLC_PREFIX = "Event_DLC/";
/**
 * Id prefix for text extracted from a Unity bundle (currently only EventOptionTips).
 * EN/CN sources live as loose files under this repo dir (`tools/extract-option-tips.py`);
 * output goes to the game's `EventLanguages_<outLang>` with a `_<LANG>` suffix.
 */
export const BUNDLE_OPTIONTIPS_PREFIX = "bundle-src/Language_EventOptionTips/";

/** True when `file` is a quest/event source id (root folder or a DLC pack). */
export function isEventFile(file: string): boolean {
  const posix = file.replace(/\\/g, "/");
  return posix.startsWith(EVENT_PREFIX) || posix.startsWith(EVENT_DLC_PREFIX);
}

/** True when `file` is the bundled EventOptionTips source id. */
export function isOptionTipsFile(file: string): boolean {
  return file.replace(/\\/g, "/").startsWith(BUNDLE_OPTIONTIPS_PREFIX);
}

export interface SourcePaths {
  /** Absolute path to the EN source file. */
  en: string;
  /** Absolute path to the CN reference file. */
  cn: string;
  /** Absolute path the RU/output pack is written to (the hijacked KO slot). */
  out: string;
}

/** Resolve the EN / CN / output paths for a source-file id. */
export function resolveSource(file: string): SourcePaths {
  const posix = file.replace(/\\/g, "/");
  if (isOptionTipsFile(posix)) {
    // Bundled EventOptionTips: EN/CN are loose files in the repo; the output goes
    // to the game's EventLanguages_<outLang> with the `_EN` suffix swapped.
    const base = posix.split("/").pop() ?? posix; // EventOptionTips_EN.txt
    return {
      en: path.join(projectRoot, posix),
      cn: path.join(projectRoot, posix.replace(/_EN\.txt$/, "_CN.txt")),
      out: path.join(eventOptionTipsOutDir(), base.replace(/_EN\.txt$/, `_${outLang}.txt`)),
    };
  }
  if (isEventFile(posix)) {
    // Event ids are full repo-relative paths; EN/CN/output are filename siblings.
    // EN source and CN reference always come from the game tree. The output
    // sibling stays in-place in the game by default, or — when TAIWU_OUTPUT_DIR
    // is set — is re-rooted under the local mirror at its real game-root-relative
    // path (so the folder overlays a game install), with the language suffix
    // swapped to outLang.
    const enPath = path.join(projectRoot, posix);
    const out = outputDir
      ? mirrorToOutput(realpathSync(enPath))
      : path.join(projectRoot, posix.replace(/_Language_EN\.txt$/, `_Language_${outLang}.txt`));
    return {
      en: enPath,
      cn: path.join(projectRoot, posix.replace(/_Language_EN\.txt$/, "_Language_CN.txt")),
      out,
    };
  }
  return {
    en: path.join(languageDir, file),
    cn: path.join(languageCnDir, file),
    out: path.join(languageRuDir, file),
  };
}
