/**
 * Translation pipeline for one paired-`.txt` file.
 *
 * Flow per unit: align EN↔CN → mask markup/glossary → (engine if translatable)
 * → restore + validate → write into the translation memory. Writes ONLY the TM
 * (never the game files). Incremental and idempotent:
 *   - units already translated with a matching srcHash are skipped;
 *   - `reviewed`/`locked` units are never overwritten (their CN reference is
 *     refreshed, but `ru` is preserved);
 *   - units whose restore validation fails are counted as `failed` and left
 *     pending — corrupted markup is never written.
 */
import { GLOSSARY_VERSION } from "../config/glossary.js";
import { alignFile } from "../align/bilingual.js";
import { loadGlossary } from "../glossary/load.js";
import type { SourceUnit } from "../formats/adapter.js";
import { mask, restore } from "../engine/protect.js";
import type { ProgressCallback, TranslationEngine, TranslationRequest } from "../engine/types.js";
import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../model/tm.js";
import { srcHash } from "../tm/hash.js";
import { loadTm, saveTm } from "../tm/store.js";

export interface TranslateOptions {
  /** Translate at most this many pending units (for sampling/dry runs). */
  limit?: number;
  /** When true, compute and validate but do not persist the TM. */
  dryRun?: boolean;
  /** ISO timestamp to stamp on updated units (kept injectable for determinism). */
  now?: string;
  /** Called with the running count of units sent to the engine for this file. */
  onProgress?: ProgressCallback;
}

export interface TranslateStats {
  file: string;
  total: number;
  pending: number;
  translated: number;
  skipped: number;
  failed: number;
  /** Restore-validation failures, for surfacing to the user. */
  failures: { key: string; error: string }[];
}

interface WorkItem {
  unit: SourceUnit;
  hash: string;
  masked: ReturnType<typeof mask>;
  /** Index into the engine batch, or -1 if it needs no engine call. */
  batchIndex: number;
}

function needsTranslation(prev: TmUnit | undefined, hash: string): boolean {
  if (!prev || prev.ru === null) return true;
  if (prev.status === "reviewed" || prev.status === "locked") return false;
  return prev.srcHash !== hash; // machine translation whose source drifted
}

export async function translateFile(
  file: string,
  engine: TranslationEngine,
  options: TranslateOptions = {},
): Promise<TranslateStats> {
  const aligned = await alignFile(file);
  const glossary = await loadGlossary();
  const existing = await loadTm(file);

  const units: Record<string, TmUnit> = {};
  const work: WorkItem[] = [];
  const batch: TranslationRequest[] = [];
  let pending = 0;
  let skipped = 0;

  for (const unit of aligned.units) {
    const hash = srcHash(unit.en, GLOSSARY_VERSION);
    const prev = existing?.units[unit.key];

    // Carry forward units that don't need (re)translation.
    if (!needsTranslation(prev, hash) && prev) {
      units[unit.key] = { ...prev, cn: unit.cn };
      skipped++;
      continue;
    }

    pending++;
    if (options.limit !== undefined && work.length >= options.limit) {
      // Beyond the limit: keep any previous state, else leave pending.
      units[unit.key] = prev ? { ...prev, cn: unit.cn } : newPendingUnit(unit, hash);
      skipped++;
      continue;
    }

    const masked = mask(unit.en, glossary);
    const item: WorkItem = { unit, hash, masked, batchIndex: -1 };
    if (masked.translatable) {
      item.batchIndex = batch.length;
      batch.push({ text: masked.masked, reference: unit.cn });
    }
    work.push(item);
  }

  const translations = batch.length > 0 ? await engine.translate(batch, options.onProgress) : [];

  let translated = 0;
  let failed = 0;
  const failures: { key: string; error: string }[] = [];

  for (const item of work) {
    const { unit, hash, masked } = item;
    const engineOut = item.batchIndex >= 0 ? (translations[item.batchIndex] ?? "") : masked.masked;
    const restored = restore(engineOut, masked);

    if (!restored.ok) {
      failed++;
      failures.push({ key: unit.key, error: restored.error ?? "restore failed" });
      const prev = existing?.units[unit.key];
      units[unit.key] = prev ? { ...prev, cn: unit.cn } : newPendingUnit(unit, hash);
      continue;
    }

    translated++;
    units[unit.key] = {
      en: unit.en,
      cn: unit.cn,
      ru: restored.text,
      status: "machine",
      srcHash: hash,
      engine: engine.id,
      updatedAt: options.now ?? null,
    };
  }

  const tm: TmFile = {
    schemaVersion: TM_SCHEMA_VERSION,
    file,
    glossaryVersion: GLOSSARY_VERSION,
    units,
  };
  if (!options.dryRun) await saveTm(tm);

  return {
    file,
    total: aligned.units.length,
    pending,
    translated,
    skipped,
    failed,
    failures,
  };
}

function newPendingUnit(unit: SourceUnit, hash: string): TmUnit {
  return {
    en: unit.en,
    cn: unit.cn,
    ru: null,
    status: "pending",
    srcHash: hash,
    engine: null,
    updatedAt: null,
  };
}
