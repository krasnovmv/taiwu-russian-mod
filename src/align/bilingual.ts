/**
 * Bilingual alignment: extract a file's translatable units (EN + CN reference)
 * via the format adapter selected for that file. Format-agnostic — works for
 * paired `.txt`, `.tsv` tables, nested `.json` and the anchored multiline `.txt`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { languageCnDir, languageDir } from "../config/paths.js";
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
  const enContent = await readFile(path.join(languageDir, file), "utf8");
  const cnContent = await readIfExists(path.join(languageCnDir, file));

  const { units, onlyCn, warnings } = adapter.extract(enContent, cnContent);
  const onlyEn = units.filter((u) => u.cn === null).map((u) => u.key);
  return { file, units, onlyEn, onlyCn, warnings };
}
