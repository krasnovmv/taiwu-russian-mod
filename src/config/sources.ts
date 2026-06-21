/**
 * Map a source-file id (the stable, repo-relative POSIX path the pipeline and TM
 * use) to the concrete EN / CN / output files on disk.
 *
 * Two source families share the pipeline:
 *
 *  - The `Language_*` packs (the default): a file id is the path RELATIVE to
 *    `Language_EN`; the CN reference and RU output sit at the SAME relative path
 *    under sibling directories (`Language_CN`, `Language_KO`).
 *
 *  - The quest/event text under `Event_Languages` (outside StreamingAssets): a
 *    file id is `Event_Languages/<package>_Language_EN.txt`. EN, CN and the
 *    output all live in ONE directory and differ only by the `_Language_XX`
 *    filename suffix — so the resolver swaps `EN` → `CN` / `KO` in the name
 *    rather than swapping the directory.
 *
 * Centralising this here keeps `align` and `apply` from hard-coding either
 * layout, and makes the event family a pure addition.
 */
import path from "node:path";

import { eventLanguagesDir, languageCnDir, languageDir, languageRuDir } from "./paths.js";

/** Id prefix that marks a quest/event source file. */
export const EVENT_PREFIX = "Event_Languages/";

/** True when `file` is a quest/event source id (under `Event_Languages`). */
export function isEventFile(file: string): boolean {
  return file.replace(/\\/g, "/").startsWith(EVENT_PREFIX);
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
  if (isEventFile(posix)) {
    const name = posix.slice(EVENT_PREFIX.length);
    const sibling = (lang: string): string =>
      path.join(eventLanguagesDir, name.replace(/_Language_EN\.txt$/, `_Language_${lang}.txt`));
    return {
      en: path.join(eventLanguagesDir, name),
      cn: sibling("CN"),
      out: sibling("KO"),
    };
  }
  return {
    en: path.join(languageDir, file),
    cn: path.join(languageCnDir, file),
    out: path.join(languageRuDir, file),
  };
}
