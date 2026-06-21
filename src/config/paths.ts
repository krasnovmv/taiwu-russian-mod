import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (two levels up from `src/config`). */
export const projectRoot = path.resolve(here, "..", "..");

/** EN language files to translate (the `Language_EN` junction in the repo root). */
export const languageDir = path.join(projectRoot, "Language_EN");

/** CN original files, used as the meaning-of-record for cross-validation. */
export const languageCnDir = path.join(projectRoot, "Language_CN");

/**
 * Quest/event text that lives OUTSIDE `StreamingAssets` — the game's `Event/
 * EventLanguages` folder (the `Event_Languages` junction in the repo root).
 *
 * Unlike the `Language_*` packs, every language shares one directory and is
 * distinguished by a filename suffix: `<package>_Language_EN.txt`,
 * `…_Language_CN.txt`, `…_Language_KO.txt`. EN is the source, CN the reference,
 * and the KO slot is hijacked for the Russian output (same trick as the main
 * pack). See `resolveSource` in `config/sources.ts` for the id→file mapping.
 */
export const eventLanguagesDir = path.join(projectRoot, "Event_Languages");

/** Git-tracked translation memory (one JSON per source file). */
export const tmDir = path.join(projectRoot, "tm");

/** Git-tracked API response cache (one append-only JSONL per engine). */
export const cacheDir = path.join(projectRoot, "cache");

/**
 * Output directory for the translated Russian language pack. `apply` mirrors
 * the EN source here (translations applied, English kept where untranslated),
 * leaving the original `Language_EN` untouched.
 *
 * The game has no Russian slot, so we hijack the Korean one: the default points
 * at the `Language_KO` junction (into the game's `StreamingAssets/Language_KO`).
 * `apply` overwrites Korean with the EN/RU pack; pick Korean in-game to play in
 * Russian. Override with `TAIWU_LANG_RU_DIR` to write elsewhere.
 */
export const languageRuDir = process.env.TAIWU_LANG_RU_DIR
  ? path.resolve(process.env.TAIWU_LANG_RU_DIR)
  : path.join(projectRoot, "Language_KO");
