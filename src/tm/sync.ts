/**
 * Reconcile a translation memory with the current source after a game update
 * (or a glossary-version bump). Does NOT call the engine — it only updates the
 * TM bookkeeping and reports what changed, so the user can review before
 * spending tokens with `translate --all`.
 *
 * Rules:
 *   - new key (in source, not in TM)      → add as `pending`
 *   - removed key (in TM, not in source)  → drop, count as removed
 *   - pending unit                        → refresh en/cn/srcHash to current
 *   - translated unit (ru set)            → keep ru/status/provenance, refresh
 *                                           cn reference, flag if source drifted
 *                                           (machine → re-translate, reviewed/
 *                                           locked → needs human review)
 */
import { alignFile, type AlignedFile } from "../align/bilingual.js";
import { GLOSSARY_VERSION } from "../config/glossary.js";
import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../model/tm.js";
import { srcHash } from "./hash.js";
import { loadTm, saveTm, tmKey } from "./store.js";

export interface SyncResult {
  file: string;
  hadTm: boolean;
  total: number;
  added: number;
  removed: number;
  /** machine translations whose source drifted (will be re-translated) */
  driftedMachine: number;
  /** reviewed/locked translations whose source drifted (need human review) */
  driftedReviewed: number;
}

/** Pure reconciliation: produce the new TM and a change report. */
export function reconcile(
  file: string,
  aligned: AlignedFile,
  existing: TmFile,
): {
  tm: TmFile;
  result: SyncResult;
} {
  const units: Record<string, TmUnit> = {};
  const sourceKeys = new Set<string>();
  let added = 0;
  let driftedMachine = 0;
  let driftedReviewed = 0;

  for (const unit of aligned.units) {
    sourceKeys.add(unit.key);
    const hash = srcHash(unit.en, GLOSSARY_VERSION);
    const prev = existing.units[unit.key];

    if (!prev) {
      units[unit.key] = {
        en: unit.en,
        cn: unit.cn,
        ru: null,
        status: "pending",
        srcHash: hash,
        engine: null,
        updatedAt: null,
      };
      added++;
    } else if (prev.ru === null) {
      // Pending: track the current source.
      units[unit.key] = { ...prev, en: unit.en, cn: unit.cn, srcHash: hash };
    } else {
      // Translated: preserve provenance, refresh CN reference, detect drift.
      if (prev.srcHash !== hash) {
        if (prev.status === "reviewed" || prev.status === "locked") driftedReviewed++;
        else driftedMachine++;
      }
      units[unit.key] = { ...prev, cn: unit.cn };
    }
  }

  const removed = Object.keys(existing.units).filter((k) => !sourceKeys.has(k)).length;

  const tm: TmFile = {
    schemaVersion: TM_SCHEMA_VERSION,
    file: tmKey(file),
    glossaryVersion: GLOSSARY_VERSION,
    units,
  };
  const result: SyncResult = {
    file,
    hadTm: true,
    total: aligned.units.length,
    added,
    removed,
    driftedMachine,
    driftedReviewed,
  };
  return { tm, result };
}

/** Reconcile one file's TM against current source. No-op if it has no TM yet. */
export async function syncFile(
  file: string,
  options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const existing = await loadTm(file);
  if (!existing) {
    return {
      file,
      hadTm: false,
      total: 0,
      added: 0,
      removed: 0,
      driftedMachine: 0,
      driftedReviewed: 0,
    };
  }
  const aligned = await alignFile(file);
  const { tm, result } = reconcile(file, aligned, existing);
  if (!options.dryRun) await saveTm(tm);
  return result;
}
