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

/** Extract and align one file's units by key. */
export async function alignFile(file: string): Promise<AlignedFile> {
  const adapter = adapterFor(file);
  const { en, cn } = resolveSource(file);
  const enContent = await readFile(en, "utf8");
  const cnContent = await readIfExists(cn);

  const { units, onlyCn, warnings } = adapter.extract(enContent, cnContent);
  const onlyEn = units.filter((u) => u.cn === null).map((u) => u.key);
  return { file, units, onlyEn, onlyCn, warnings };
}
