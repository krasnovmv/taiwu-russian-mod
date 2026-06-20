import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (two levels up from `src/config`). */
export const projectRoot = path.resolve(here, "..", "..");

/** EN language files to translate (the `Language_EN` junction in the repo root). */
export const languageDir = path.join(projectRoot, "Language_EN");

/** CN original files, used as the meaning-of-record for cross-validation. */
export const languageCnDir = path.join(projectRoot, "Language_CN");

/** Git-tracked translation memory (one JSON per source file). */
export const tmDir = path.join(projectRoot, "tm");

/** Git-tracked API response cache (one append-only JSONL per engine). */
export const cacheDir = path.join(projectRoot, "cache");

/**
 * Output directory for the translated Russian language pack. `apply` mirrors
 * the EN source here (translations applied, English kept where untranslated),
 * leaving the original `Language_EN` untouched. Override with `TAIWU_LANG_RU_DIR`.
 */
export const languageRuDir = process.env.TAIWU_LANG_RU_DIR
  ? path.resolve(process.env.TAIWU_LANG_RU_DIR)
  : path.join(projectRoot, "Language_RU");
