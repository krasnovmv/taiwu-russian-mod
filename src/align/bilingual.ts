/**
 * Bilingual alignment: extract a file's translatable units (EN + CN reference)
 * via the format adapter selected for that file. Format-agnostic — works for
 * paired `.txt`, `.tsv` tables, nested `.json`, the anchored multiline `.txt`
 * and the `Event_Languages` quest text. The EN/CN files are located via
 * {@link resolveSource}, which knows each family's on-disk layout.
 */
import { readFile } from "node:fs/promises";

import { applySourceFixes } from "../config/source-fixes.js";
import { resolveSource } from "../config/sources.js";
import { stripMarkup } from "../engine/protect.js";
import type { SourceUnit } from "../formats/adapter.js";
import { adapterFor } from "../formats/registry.js";

export interface AlignedFile {
  file: string;
  units: SourceUnit[];
  /** Keys present in EN but missing in CN (translatable, no reference). */
  onlyEn: string[];
  /** Keys present in CN but missing in EN (nothing to output). */
  onlyCn: string[];
  /** Non-fatal anomalies from the adapter. */
  warnings: string[];
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Per-process memo of aligned files. A single CLI run aligns each file up to 4×
 * (plan + translate, across two routed passes) and the source language files
 * don't change mid-run, so parsing them once and sharing the result is safe and
 * removes the redundant reads. Consumers treat {@link AlignedFile} as read-only.
 * Call {@link clearAlignCache} between runs that mutate sources (tests).
 */
const alignCache = new Map<string, Promise<AlignedFile>>();

/** Drop the {@link alignFile} memo (for tests that swap source fixtures). */
export function clearAlignCache(): void {
  alignCache.clear();
}

/** Extract and align one file's units by key (memoized per process). */
export function alignFile(file: string): Promise<AlignedFile> {
  const cached = alignCache.get(file);
  if (cached) return cached;
  const promise = alignFileUncached(file);
  alignCache.set(file, promise);
  // Don't cache a rejection: a transient read error shouldn't poison later calls.
  promise.catch(() => alignCache.delete(file));
  return promise;
}

// A Latin letter anywhere in the EN source means the string is (at least partly)
// English prose — a Chinese name inside an English sentence stays an EN unit.
const LATIN_RE = /[A-Za-z]/;
const HAN_RE = /\p{Script=Han}/u;

/**
 * Mark units whose EN source is *wholly* Chinese as `zh`-source.
 *
 * The EN pack ships some fields the developers never translated: the value is the
 * Chinese original under an English key. Two things then went wrong. Where the CN
 * pack held the same text, the pipeline's EN==CN heuristic read it as
 * "language-neutral" (an id, a number) and copied it straight into `ru` — shipping
 * hanzi as the Russian. Where the CN pack had no such key at all, the string went
 * to the engine labelled English. Both are the same unit: Chinese source text, so
 * say so. A `cn` that merely repeats the source is dropped — that is the existing
 * `srcLang:"zh"` convention (see the adapter's CN-only path), and it also keeps
 * EN==CN from firing.
 *
 * Markup is stripped first so a Chinese line wrapped in `<color=…>` still counts.
 */
function markZhSource(units: SourceUnit[]): SourceUnit[] {
  return units.map((u) => {
    if (u.srcLang === "zh") return u;
    const bare = stripMarkup(u.en);
    if (LATIN_RE.test(bare) || !HAN_RE.test(bare)) return u;
    return { ...u, cn: u.cn === u.en ? null : u.cn, srcLang: "zh" };
  });
}

async function alignFileUncached(file: string): Promise<AlignedFile> {
  const adapter = adapterFor(file);
  const { en, cn } = resolveSource(file);
  const enContent = await readFile(en, "utf8");
  const cnContent = await readIfExists(cn);

  const { units: extracted, onlyCn, warnings } = adapter.extract(enContent, cnContent);
  // Repair known source-text markup defects before anything hashes, masks or
  // validates the units (see config/source-fixes.ts), then label the ones whose
  // "English" is really Chinese so they are translated, not copied.
  const units = markZhSource(applySourceFixes(file, extracted, warnings));
  // EN-only = translatable from EN with no CN reference. CN-only units (srcLang
  // "zh") also have `cn === null` but are the opposite case, so exclude them.
  const onlyEn = units.filter((u) => u.cn === null && u.srcLang !== "zh").map((u) => u.key);
  return { file, units, onlyEn, onlyCn, warnings };
}
