/**
 * Translation pipeline for one source file.
 *
 * Flow per unit: align EN↔CN → mask markup → (engine, which applies the glossary,
 * if translatable) → restore + validate → write into the translation memory.
 * Writes ONLY the TM
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
import { alignFile, type AlignedFile } from "../align/bilingual.js";
import type { SourceUnit } from "../formats/adapter.js";
import { CACHE_MISS } from "../engine/caching.js";
import { mask, restore } from "../engine/protect.js";
import type { ProgressCallback, TranslationEngine, TranslationRequest } from "../engine/types.js";
import { loadGlossary } from "../glossary/load.js";
import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../model/tm.js";
import { makeSrcHasher, type SrcHasher } from "../tm/hash.js";
import { loadTm, saveTm, tmKey } from "../tm/store.js";

export interface TranslateOptions {
  /** Translate at most this many pending units (for sampling/dry runs). */
  limit?: number;
  /** When true, compute and validate but do not persist the TM. */
  dryRun?: boolean;
  /** ISO timestamp to stamp on updated units (kept injectable for determinism). */
  now?: string;
  /** Only translate units with `minLen <= en.length <= maxLen` (the engine's window). */
  minLen?: number;
  maxLen?: number;
  /**
   * Re-process `machine` units that are otherwise up to date (matching srcHash and
   * engine), so an edited cache entry flows back into the TM. Meant for cache-only
   * rebuilds: a hit overwrites `ru` (only when it actually changed), a miss leaves
   * the unit untouched. `reviewed`/`locked` units are still never touched.
   */
  refreshCached?: boolean;
  /** Called once with the number of units that will be sent to the engine. */
  onStart?: (totalUnits: number) => void;
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
  /** Cache-only run: units that missed the cache and were left pending. */
  cacheMissed: number;
  /** Restore-validation failures, for surfacing to the user. */
  failures: { key: string; error: string }[];
}

interface WorkItem {
  unit: SourceUnit;
  hash: string;
  masked: ReturnType<typeof mask>;
}

/** Engine marker for language-neutral units (EN == CN) whose RU is just the EN. */
const NEUTRAL_ENGINE = "neutral";

export function needsTranslation(
  prev: TmUnit | undefined,
  hash: string,
  engineId: string,
  refreshCached = false,
): boolean {
  if (!prev || prev.ru === null) return true;
  if (prev.status === "reviewed" || prev.status === "locked") return false;
  // Re-translate machine units whose source drifted OR whose engine no longer
  // matches the routed engine (so routing/cap changes adopt the chosen engine).
  if (prev.srcHash !== hash || prev.engine !== engineId) return true;
  // Up-to-date machine unit: normally skipped, but a refresh run re-serves it from
  // the cache so an edited cache entry can overwrite the stored translation.
  return refreshCached;
}

/**
 * Select which units a run will (re)translate: build the TM unit map and the
 * engine work list, applying the length window, the limit, and the up-to-date /
 * engine-match skip. Shared by {@link translateFile} and {@link planFile} so the
 * progress total and the actual work never drift.
 */
function selectWork(
  aligned: AlignedFile,
  existing: TmFile | null,
  engineId: string,
  hashEn: SrcHasher,
  options: Pick<TranslateOptions, "minLen" | "maxLen" | "limit" | "now" | "refreshCached">,
): { units: Record<string, TmUnit>; work: WorkItem[]; pending: number; skipped: number } {
  const minLen = options.minLen ?? 0;
  const maxLen = options.maxLen ?? Infinity;
  const units: Record<string, TmUnit> = {};
  const work: WorkItem[] = [];
  let pending = 0;
  let skipped = 0;

  for (const unit of aligned.units) {
    const hash = hashEn(unit.en);
    const prev = existing?.units[unit.key];
    const inWindow = unit.en.length >= minLen && unit.en.length <= maxLen;
    // Language-neutral: identical in EN and CN (IDs, paths, codes, untranslated
    // terms) → never send to an engine. Copy EN straight into RU so the TM is
    // complete (no lingering pending unit) and the source rides through apply.
    const sameAsCn = unit.cn !== null && unit.en === unit.cn;
    if (sameAsCn) {
      const human = prev?.status === "reviewed" || prev?.status === "locked";
      const alreadyNeutral =
        prev?.engine === NEUTRAL_ENGINE && prev.ru === unit.en && prev.srcHash === hash;
      // Honour human curation; otherwise reuse an existing neutral unit (no
      // timestamp churn) or mint a fresh one with ru = en.
      units[unit.key] =
        prev && (human || alreadyNeutral)
          ? { ...prev, cn: unit.cn }
          : neutralUnit(unit, hash, options.now ?? null);
      skipped++;
      continue;
    }

    // Out of window or already up to date: carry forward unchanged (a unit out
    // of window keeps any translation another pass made).
    if (!inWindow || !needsTranslation(prev, hash, engineId, options.refreshCached)) {
      units[unit.key] = prev ? { ...prev, cn: unit.cn } : newPendingUnit(unit, hash);
      skipped++;
      continue;
    }

    pending++;
    units[unit.key] = prev ? { ...prev, cn: unit.cn } : newPendingUnit(unit, hash);

    if (options.limit !== undefined && work.length >= options.limit) {
      skipped++; // beyond the limit: stays pending
      continue;
    }
    work.push({ unit, hash, masked: mask(unit.en) });
  }
  return { units, work, pending, skipped };
}

/**
 * Count how many units a run would send to the engine for `file` (the
 * translatable work) — without translating. Used to size a single global
 * progress total across all files before a run starts.
 */
export async function planFile(
  file: string,
  engineId: string,
  options: Pick<TranslateOptions, "minLen" | "maxLen" | "limit" | "refreshCached"> = {},
): Promise<number> {
  const aligned = await alignFile(file);
  const existing = await loadTm(file);
  const hashEn = makeSrcHasher(await loadGlossary());
  const { work } = selectWork(aligned, existing, engineId, hashEn, options);
  return work.reduce((n, w) => (w.masked.translatable ? n + 1 : n), 0);
}

export async function translateFile(
  file: string,
  engine: TranslationEngine,
  options: TranslateOptions = {},
): Promise<TranslateStats> {
  const aligned = await alignFile(file);
  const existing = await loadTm(file);
  const hashEn = makeSrcHasher(await loadGlossary());
  const { units, work, pending, skipped } = selectWork(aligned, existing, engine.id, hashEn, options);

  const tm: TmFile = {
    schemaVersion: TM_SCHEMA_VERSION,
    file: tmKey(file),
    glossaryVersion: GLOSSARY_VERSION,
    units,
  };
  const flush = async (): Promise<void> => {
    if (!options.dryRun) await saveTm(tm);
  };
  // Checkpoints exist to bound work lost if a *live* (billed) run is interrupted.
  // A cache-only rebuild does zero network I/O and is cheap to redo, so its only
  // effect would be quadratic full-file rewrites (a file of N units → N/checkpoint
  // rewrites) — defer to a single flush at the end instead.
  const deferFlush = engine.cacheOnly === true;

  // The unit bar tracks units that actually hit the engine (translatable).
  options.onStart?.(work.reduce((n, w) => n + (w.masked.translatable ? 1 : 0), 0));

  let translated = 0;
  let failed = 0;
  let cacheMissed = 0;
  let progressBase = 0;
  let dirty = false;
  const failures: { key: string; error: string }[] = [];
  const checkpoint = Math.max(1, engine.checkpointSize);

  for (let start = 0; start < work.length; start += checkpoint) {
    const chunk = work.slice(start, start + checkpoint);

    // Only translatable items hit the engine; the rest restore to themselves.
    const requests: TranslationRequest[] = [];
    const requestIndex = chunk.map((item) => {
      if (!item.masked.translatable) return -1;
      requests.push({
        text: item.masked.masked,
        reference: item.unit.cn,
        sourceLang: item.unit.srcLang,
      });
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
      // Cache-only run: a miss is not a failure — leave the unit pending so a
      // later real engine run still picks it up.
      if (engineOut === CACHE_MISS) {
        cacheMissed++;
        return;
      }
      const restored = restore(engineOut, item.masked);
      if (!restored.ok) {
        failed++;
        failures.push({ key: item.unit.key, error: restored.error ?? "restore failed" });
        return; // leave the pending placeholder in place
      }
      // No-op refresh: the cache served the same value already in the TM. Leave the
      // unit (and its updatedAt) untouched so cache rebuilds don't churn the diff.
      const before = units[item.unit.key];
      if (
        before &&
        before.status === "machine" &&
        before.ru === restored.text &&
        before.srcHash === item.hash &&
        before.engine === engine.id
      ) {
        return;
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

    dirty = true;
    if (!deferFlush) {
      await flush(); // checkpoint after each chunk on live runs
      dirty = false;
    }
  }

  // Flush once at the end: for a deferred (cache-only) run this is the only write;
  // otherwise it persists any carried-forward CN refresh when there was no work.
  if (dirty || work.length === 0) await flush();

  return {
    file,
    total: aligned.units.length,
    pending,
    translated,
    skipped,
    failed,
    cacheMissed,
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

/** A language-neutral unit (EN == CN): RU is the EN source, no engine involved. */
function neutralUnit(unit: SourceUnit, hash: string, now: string | null): TmUnit {
  return {
    en: unit.en,
    cn: unit.cn,
    ru: unit.en,
    status: "machine",
    srcHash: hash,
    engine: NEUTRAL_ENGINE,
    updatedAt: now,
  };
}
