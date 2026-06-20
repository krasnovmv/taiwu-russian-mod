/**
 * Bilingual alignment: join EN and CN entries of one file by key.
 *
 * Keys are shared across languages, so the join is by normalized (trimmed) key
 * rather than by line position (EN and CN line counts differ slightly). The EN
 * value's line index is kept so a translation can be written back into the EN
 * raw file without disturbing any other byte.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { languageCnDir, languageDir } from "../config/paths.js";
import { parsePairs } from "../formats/paired-txt.js";

export interface AlignedUnit {
  /** Normalized (trimmed) join key. */
  key: string;
  /** EN source value. */
  en: string;
  /** CN reference value, or null if the key is absent in CN. */
  cn: string | null;
  /** Index of the EN value line in the EN raw file (for in-place writeback). */
  enValueIndex: number;
}

export interface AlignedFile {
  file: string;
  units: AlignedUnit[];
  /** Keys present in EN but missing in CN (still translatable, no reference). */
  onlyEn: string[];
  /** Keys present in CN but missing in EN (nothing to output). */
  onlyCn: string[];
}

interface IndexedValue {
  value: string;
  valueIndex: number;
}

function indexByKey(content: string): Map<string, IndexedValue> {
  const { entries } = parsePairs(content);
  const map = new Map<string, IndexedValue>();
  for (const entry of entries) {
    const key = entry.key.trim();
    // First occurrence wins; duplicate keys do not occur in clean files.
    if (!map.has(key)) {
      map.set(key, { value: entry.value, valueIndex: entry.valueIndex });
    }
  }
  return map;
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Align one file's EN and CN entries by key. */
export async function alignFile(file: string): Promise<AlignedFile> {
  const enContent = await readFile(path.join(languageDir, file), "utf8");
  const enMap = indexByKey(enContent);

  const cnContent = await readIfExists(path.join(languageCnDir, file));
  const cnMap = cnContent === null ? new Map<string, IndexedValue>() : indexByKey(cnContent);

  const units: AlignedUnit[] = [];
  const onlyEn: string[] = [];
  for (const [key, en] of enMap) {
    const cn = cnMap.get(key);
    if (cn === undefined) onlyEn.push(key);
    units.push({ key, en: en.value, cn: cn?.value ?? null, enValueIndex: en.valueIndex });
  }

  const onlyCn: string[] = [];
  for (const key of cnMap.keys()) {
    if (!enMap.has(key)) onlyCn.push(key);
  }

  return { file, units, onlyEn, onlyCn };
}
