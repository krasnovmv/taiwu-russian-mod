/**
 * Bilingual alignment: extract a file's translatable units (EN + CN reference)
 * via the format adapter selected for that file. Format-agnostic — works for
 * paired `.txt`, `.tsv` tables, nested `.json`, the anchored multiline `.txt`
 * and the `Event_Languages` quest text. The EN/CN files are located via
 * {@link resolveSource}, which knows each family's on-disk layout.
 */
import { readFile } from "node:fs/promises";

import { resolveSource } from "../config/sources.js";
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

async function alignFileUncached(file: string): Promise<AlignedFile> {
  const adapter = adapterFor(file);
  const { en, cn } = resolveSource(file);
  const enContent = await readFile(en, "utf8");
  const cnContent = await readIfExists(cn);

  const { units, onlyCn, warnings } = adapter.extract(enContent, cnContent);
  // EN-only = translatable from EN with no CN reference. CN-only units (srcLang
  // "zh") also have `cn === null` but are the opposite case, so exclude them.
  const onlyEn = units.filter((u) => u.cn === null && u.srcLang !== "zh").map((u) => u.key);
  return { file, units, onlyEn, onlyCn, warnings };
}
