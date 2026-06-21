/**
 * Build the Russian language pack: read each EN source file, apply translations
 * from the TM, and write the result into the output (hijacked KO) slot. The EN
 * source is never modified, so this is fully reversible.
 *
 * Per file: build translated content → structural guard → atomic write to the
 * output path. Untranslated units keep their English text, so the mirror is a
 * complete, loadable language folder even when partially translated. The EN and
 * output paths come from {@link resolveSource} (which handles both the
 * `Language_*` packs and the `Event_Languages` quest text); the optional
 * `srcDir`/`outDir` overrides let tests redirect the `Language_*` family.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveSource } from "../config/sources.js";
import { adapterFor } from "../formats/registry.js";
import type { TmFile } from "../model/tm.js";
import { loadTm } from "../tm/store.js";
import { writeFileAtomic } from "../util/fs.js";

export interface ApplyOptions {
  /** EN source dir override (default: resolved per source family). */
  srcDir?: string;
  /** Output dir override (default: resolved per source family). */
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
  const resolved = resolveSource(file);
  const srcPath = options.srcDir ? path.join(options.srcDir, file) : resolved.en;
  const outPath = options.outDir ? path.join(options.outDir, file) : resolved.out;
  const tm = options.tm !== undefined ? options.tm : await loadTm(file);

  const original = await readFile(srcPath, "utf8");

  // Per unit: the RU translation where available, English otherwise. A cell that
  // is identical in EN and CN is language-neutral (IDs, paths, codes) — keep the
  // source and ignore any (stale) machine translation. Human-curated units
  // (reviewed/locked) are always honoured.
  const translations = new Map<string, string>();
  if (tm) {
    for (const [key, unit] of Object.entries(tm.units)) {
      const human = unit.status === "reviewed" || unit.status === "locked";
      const keepSource = !human && unit.cn !== null && unit.en === unit.cn;
      translations.set(key, keepSource ? unit.en : (unit.ru ?? unit.en));
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

  await writeFileAtomic(outPath, built.content);
  return { ...base, written: true };
}
