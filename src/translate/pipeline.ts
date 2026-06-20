/**
 * Translation pipeline for one source file.
 *
 * Flow per unit: align EN↔CN → mask markup/glossary → (engine if translatable)
 * → restore + validate → write into the translation memory. Writes ONLY the TM
 * (never the game files). Incremental and idempotent:
 *   - units already translated with a matching srcHash are skipped;
 *   - `reviewed`/`locked` units are never overwritten (their CN reference is
 *     refreshed, but `ru` is preserved);
 *   - units whose restore validation fails are counted as `failed` and left
 *     pending — corrupted markup is never written.
 *
 * The TM is flushed in checkpoints of `engine.checkpointSize` units, so an
 * interrupted run loses at most one checkpoint's worth of work (not the whole
 * file). Every key is present in the TM from the first flush as `pending` and is
 * upgraded to `machine` as checkpoints complete.
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
    // Every key is present in the TM from the start, as pending; checkpoints
    // upgrade the translated ones in place.
    units[unit.key] = prev ? { ...prev, cn: unit.cn } : newPendingUnit(unit, hash);

    if (options.limit !== undefined && work.length >= options.limit) {
      skipped++; // beyond the limit: stays pending
      continue;
    }
    work.push({ unit, hash, masked: mask(unit.en, glossary) });
  }

  const tm: TmFile = {
    schemaVersion: TM_SCHEMA_VERSION,
    file,
    glossaryVersion: GLOSSARY_VERSION,
    units,
  };
  const flush = async (): Promise<void> => {
    if (!options.dryRun) await saveTm(tm);
  };

  let translated = 0;
  let failed = 0;
  let progressBase = 0;
  const failures: { key: string; error: string }[] = [];
  const checkpoint = Math.max(1, engine.checkpointSize);

  for (let start = 0; start < work.length; start += checkpoint) {
    const chunk = work.slice(start, start + checkpoint);

    // Only translatable items hit the engine; the rest restore to themselves.
    const requests: TranslationRequest[] = [];
    const requestIndex = chunk.map((item) => {
      if (!item.masked.translatable) return -1;
      requests.push({ text: item.masked.masked, reference: item.unit.cn });
      return requests.length - 1;
    });

    const base = progressBase;
    const translations =
      requests.length > 0
        ? await engine.translate(requests, (n) => options.onProgress?.(base + n))
        : [];
    progressBase += requests.length;

    chunk.forEach((item, i) => {
      const ri = requestIndex[i] ?? -1;
      const engineOut = ri >= 0 ? (translations[ri] ?? "") : item.masked.masked;
      const restored = restore(engineOut, item.masked);
      if (!restored.ok) {
        failed++;
        failures.push({ key: item.unit.key, error: restored.error ?? "restore failed" });
        return; // leave the pending placeholder in place
      }
      translated++;
      units[item.unit.key] = {
        en: item.unit.en,
        cn: item.unit.cn,
        ru: restored.text,
        status: "machine",
        srcHash: item.hash,
        engine: engine.id,
        updatedAt: options.now ?? null,
      };
    });

    await flush(); // checkpoint after each chunk
  }

  // No work (e.g. fully cached or limit 0): still persist carried-forward CN refresh.
  if (work.length === 0) await flush();

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
