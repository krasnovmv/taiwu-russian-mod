import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (two levels up from `src/config`). */
export const projectRoot = path.resolve(here, "..", "..");

/**
 * Directory holding the EN language files to translate.
 *
 * Defaults to the `Language_EN` junction in the repo root (which points at the
 * game install). Override with the `TAIWU_LANG_DIR` environment variable, e.g.
 * to run against a copy or a different game path.
 */
export const languageDir = process.env.TAIWU_LANG_DIR
  ? path.resolve(process.env.TAIWU_LANG_DIR)
  : path.join(projectRoot, "Language_EN");

/**
 * Directory holding the CN original files, used as the meaning-of-record for
 * cross-validation. Override with `TAIWU_LANG_CN_DIR`. Sits next to the EN dir
 * by default (`.../Language_CN`).
 */
export const languageCnDir = process.env.TAIWU_LANG_CN_DIR
  ? path.resolve(process.env.TAIWU_LANG_CN_DIR)
  : path.join(path.dirname(languageDir), "Language_CN");
