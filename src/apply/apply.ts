/**
 * Build the Russian language pack: read each EN source file, apply translations
 * from the TM, and write the result into `Language_RU`. The original
 * `Language_EN` is never modified, so this is fully reversible (delete the
 * output folder to undo).
 *
 * Per file: build translated content → structural guard → atomic write to the
 * output dir. Untranslated units keep their English text, so the mirror is a
 * complete, loadable language folder even when partially translated.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { languageDir, languageRuDir } from "../config/paths.js";
import { adapterFor } from "../formats/registry.js";
import type { TmFile } from "../model/tm.js";
import { loadTm } from "../tm/store.js";
import { writeFileAtomic } from "./fs.js";

export interface ApplyOptions {
  /** EN source dir (default `Language_EN`). */
  srcDir?: string;
  /** RU output dir (default `Language_RU`). */
  outDir?: string;
  /** Inject the TM instead of loading it (tests); `null` means "no TM". */
  tm?: TmFile | null;
  /** Build and validate, but do not write. */
  dryRun?: boolean;
}

export interface ApplyResult {
  file: string;
  applied: number;
  unsafe: number;
  unsafeKeys: string[];
  written: boolean;
  reason?: string;
}

export async function applyFile(file: string, options: ApplyOptions = {}): Promise<ApplyResult> {
  const srcDir = options.srcDir ?? languageDir;
  const outDir = options.outDir ?? languageRuDir;
  const tm = options.tm !== undefined ? options.tm : await loadTm(file);

  const original = await readFile(path.join(srcDir, file), "utf8");

  // Every unit (ru ?? en): translated where available, English otherwise.
  const translations = new Map<string, string>();
  if (tm) {
    for (const [key, unit] of Object.entries(tm.units)) {
      translations.set(key, unit.ru ?? unit.en);
    }
  }

  const built = adapterFor(file).apply(original, translations);
  const base = { file, applied: built.applied, unsafe: built.unsafe, unsafeKeys: built.unsafeKeys };

  if (!built.guardOk) {
    return {
      ...base,
      written: false,
      reason: `structural guard failed: ${built.guardError ?? "?"}`,
    };
  }
  if (options.dryRun) {
    return { ...base, written: false, reason: "dry-run" };
  }

  await writeFileAtomic(path.join(outDir, file), built.content);
  return { ...base, written: true };
}
