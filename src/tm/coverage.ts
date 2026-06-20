/**
 * Coverage computation: compare aligned source units against the current TM to
 * classify each unit as translated / stale / pending. Read-only — it never
 * mutates the TM (sync/translation happens in later phases).
 */
import { GLOSSARY_VERSION } from "../config/glossary.js";
import { withinLengthCap } from "../config/translate.js";
import type { AlignedFile } from "../align/bilingual.js";
import type { TmFile } from "../model/tm.js";
import { srcHash } from "./hash.js";

export interface FileCoverage {
  file: string;
  total: number;
  /** Has RU and its srcHash matches the current EN source + glossary. */
  translated: number;
  /** Has RU but the source has drifted since (needs re-translation/review). */
  stale: number;
  /** No usable RU yet (and eligible for translation under the length cap). */
  pending: number;
  /** EN source characters across pending units (the work left to translate). */
  pendingChars: number;
  /** Units left untranslated by the length cap (not counted as pending). */
  outOfScope: number;
  onlyEn: number;
  onlyCn: number;
}

export function computeCoverage(aligned: AlignedFile, tm: TmFile | null): FileCoverage {
  let translated = 0;
  let stale = 0;
  let pending = 0;
  let pendingChars = 0;
  let outOfScope = 0;

  for (const unit of aligned.units) {
    const tmUnit = tm?.units[unit.key];
    const human = tmUnit?.status === "reviewed" || tmUnit?.status === "locked";
    // Units beyond the length cap are out of scope (English is kept), unless a
    // human curated them — those are always honoured.
    if (!human && !withinLengthCap(unit.en)) {
      outOfScope++;
      continue;
    }
    const hash = srcHash(unit.en, GLOSSARY_VERSION);
    if (tmUnit?.ru != null) {
      if (tmUnit.srcHash === hash) translated++;
      else stale++;
    } else {
      pending++;
      pendingChars += unit.en.length;
    }
  }

  return {
    file: aligned.file,
    total: aligned.units.length,
    translated,
    stale,
    pending,
    pendingChars,
    outOfScope,
    onlyEn: aligned.onlyEn.length,
    onlyCn: aligned.onlyCn.length,
  };
}

/** Aggregate per-file coverage into a single total. */
export function sumCoverage(parts: FileCoverage[]): Omit<FileCoverage, "file"> {
  const zero = {
    total: 0,
    translated: 0,
    stale: 0,
    pending: 0,
    pendingChars: 0,
    outOfScope: 0,
    onlyEn: 0,
    onlyCn: 0,
  };
  return parts.reduce((acc, p) => {
    acc.total += p.total;
    acc.translated += p.translated;
    acc.stale += p.stale;
    acc.pending += p.pending;
    acc.pendingChars += p.pendingChars;
    acc.outOfScope += p.outOfScope;
    acc.onlyEn += p.onlyEn;
    acc.onlyCn += p.onlyCn;
    return acc;
  }, zero);
}
