/**
 * Glossary loader. Reads `data/glossary.json` (EN→RU terms) into a lowercased
 * map for case-insensitive matching. Keys starting with `_` are metadata and
 * ignored. Loaded once and cached.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "../config/paths.js";

const glossaryPath = path.join(projectRoot, "data", "glossary.json");

let cached: ReadonlyMap<string, string> | null = null;

/** Load the glossary as a lowercased EN→RU map (cached across calls). */
export async function loadGlossary(): Promise<ReadonlyMap<string, string>> {
  if (cached) return cached;

  let raw: string;
  try {
    raw = await readFile(glossaryPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      cached = new Map();
      return cached;
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as Record<string, string>;
  const map = new Map<string, string>();
  for (const [en, ru] of Object.entries(parsed)) {
    if (en.startsWith("_")) continue;
    map.set(en.toLowerCase(), ru);
  }
  cached = map;
  return cached;
}
