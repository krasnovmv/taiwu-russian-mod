/**
 * Apply the translation memory into the EN language files, in place.
 *
 * Per file: pristine-backup (once) → build translated content → structural
 * guard → atomic write. Never writes when the guard fails or nothing changed.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { backupDir as defaultBackupDir, languageDir } from "../config/paths.js";
import { adapterFor } from "../formats/registry.js";
import type { TmFile } from "../model/tm.js";
import { loadTm } from "../tm/store.js";
import { ensureBackup, writeFileAtomic } from "./fs.js";

export interface ApplyOptions {
  srcDir?: string;
  backupDir?: string;
  /** Inject the TM instead of loading it from disk (used by tests). */
  tm?: TmFile;
  /** Build and validate, but do not back up or write. */
  dryRun?: boolean;
}

export interface ApplyResult {
  file: string;
  applied: number;
  unsafe: number;
  unsafeKeys: string[];
  /** Whether the file was (or would be) written. */
  written: boolean;
  /** Reason the file was not written, if any. */
  reason?: string;
}

export async function applyFile(file: string, options: ApplyOptions = {}): Promise<ApplyResult> {
  const srcDir = options.srcDir ?? languageDir;
  const backups = options.backupDir ?? defaultBackupDir;

  const tm = options.tm ?? (await loadTm(file));
  if (!tm) {
    return { file, applied: 0, unsafe: 0, unsafeKeys: [], written: false, reason: "no TM" };
  }

  const original = await readFile(path.join(srcDir, file), "utf8");

  // Pass every unit (ru ?? en) so adapters that need the full key set (anchored)
  // have it; identity entries (ru === en) are no-ops in every adapter.
  const translations = new Map<string, string>();
  for (const [key, unit] of Object.entries(tm.units)) {
    translations.set(key, unit.ru ?? unit.en);
  }
  const built = adapterFor(file).apply(original, translations);

  if (!built.guardOk) {
    return {
      file,
      applied: built.applied,
      unsafe: built.unsafe,
      unsafeKeys: built.unsafeKeys,
      written: false,
      reason: `structural guard failed: ${built.guardError ?? "unknown"}`,
    };
  }

  const base = {
    file,
    applied: built.applied,
    unsafe: built.unsafe,
    unsafeKeys: built.unsafeKeys,
  };

  if (built.applied === 0) {
    return { ...base, written: false, reason: "no changes" };
  }
  if (options.dryRun) {
    return { ...base, written: false, reason: "dry-run" };
  }

  await ensureBackup(file, srcDir, backups);
  await writeFileAtomic(path.join(srcDir, file), built.content);
  return { ...base, written: true };
}
