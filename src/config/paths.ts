import { realpathSync } from "node:fs";
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

/**
 * Container of per-DLC junctions (one per expansion: `Event_DLC/<DLC>` →
 * `…_Data/<DLC>`). Each DLC keeps versioned subfolders
 * (`<version>/Events/EventLanguages/<package>_Language_XX.txt`) in the same
 * block format as the root `Event_Languages`; discovery picks the newest
 * version that actually has EN text. Unlike the root quest folder, DLC quests
 * are NOT gated behind `TAIWU_EVENTS` — they are a small, always-on part of the
 * pipeline.
 */
export const eventDlcDir = path.join(projectRoot, "Event_DLC");

/** Git-tracked translation memory (one JSON per source file). */
export const tmDir = path.join(projectRoot, "tm");

/** Git-tracked API response cache (one append-only JSONL per engine). */
export const cacheDir = path.join(projectRoot, "cache");

/**
 * The single output-language slot the translated pack is written to. The game
 * has no Russian slot, so by default we hijack the Korean one (`KO`); pick that
 * language in-game to play in Russian. This ONE knob drives both output layouts:
 * the main pack directory (`Language_<LANG>`) and the event filename suffix
 * (`_Language_<LANG>.txt`), so they never drift apart. Set `TAIWU_OUT_LANG=EN`
 * to overwrite the English slot instead (back up the originals first — `EN` is
 * also the translation source).
 */
export const outLang = (process.env.TAIWU_OUT_LANG ?? "KO").toUpperCase();

/**
 * When set, ALL output (the main pack AND the event/quest text) is collected
 * under this one local directory instead of being written into the game,
 * preserving the game's relative layout: `Language_<outLang>/…` for the pack and
 * `Event_Languages/…`, `Event_DLC/…` (filenames suffixed `_Language_<outLang>`)
 * for quests. Lets you build a self-contained pack to inspect or distribute
 * without touching the install. `null` = the legacy in-place game layout.
 */
export const outputDir = process.env.TAIWU_OUTPUT_DIR
  ? path.resolve(process.env.TAIWU_OUTPUT_DIR)
  : null;

/**
 * Game install root, resolved from the `Language_EN` junction target
 * (`<root>/<…_Data>/StreamingAssets/Language_EN` → up three). Resolved lazily and
 * cached, so commands that never mirror output don't pay the `realpath` (or fail
 * when the junction is absent).
 */
let gameRootCache: string | null = null;
export function gameRoot(): string {
  if (gameRootCache) return gameRootCache;
  const real = realpathSync(languageDir);
  gameRootCache = path.dirname(path.dirname(path.dirname(real)));
  return gameRootCache;
}

/**
 * Map a real in-game file path to its slot under the local {@link outputDir}
 * mirror, preserving the FULL game-root-relative layout (so the folder can be
 * dropped straight onto a game install) and swapping the `Language_EN` token to
 * `Language_<outLang>` (covers both the pack dir segment and the `_Language_EN`
 * filename suffix of quest files). Only meaningful when `outputDir` is set.
 */
export function mirrorToOutput(realGamePath: string): string {
  const rel = path.relative(gameRoot(), realGamePath).split("Language_EN").join(`Language_${outLang}`);
  return path.join(outputDir as string, rel);
}

/**
 * Output directory for the translated language pack. `apply` mirrors the EN
 * source here (translations applied, English kept where untranslated), leaving
 * the original `Language_EN` untouched (unless `outLang` is `EN` and output goes
 * into the game in-place).
 *
 * - `TAIWU_LANG_RU_DIR` set → that exact path (highest priority).
 * - `TAIWU_OUTPUT_DIR` set → the pack slot inside the game-root mirror
 *   (`<outputDir>/<…_Data>/StreamingAssets/Language_<outLang>`).
 * - otherwise → the in-game `Language_<outLang>` junction.
 */
export const languageRuDir = process.env.TAIWU_LANG_RU_DIR
  ? path.resolve(process.env.TAIWU_LANG_RU_DIR)
  : outputDir
    ? mirrorToOutput(realpathSync(languageDir))
    : path.join(projectRoot, `Language_${outLang}`);
