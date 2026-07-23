/**
 * Glossary loader. Reads `data/glossary.json5` (EN→RU terms) into lowercased maps
 * for case-insensitive matching. Keys starting with `_` are metadata and
 * ignored. Loaded once and cached.
 *
 * A value is either a bare RU string (`"Sect": "секта"`) or an object
 * `{ ru, feed }`. `feed` is an optional engine-facing surrogate for the EN key,
 * used when the raw term confuses the MT engine (e.g. a period in `Phy.` that
 * Yandex reads as a sentence boundary). It is collected into a separate
 * EN→feed map handed only to the engine; matching still keys on the real term.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import JSON5 from "json5";

import { projectRoot } from "../config/paths.js";

const glossaryPath = path.join(projectRoot, "data", "glossary.json5");

/** A glossary value: a bare RU string, or `{ ru, feed? }`. */
type GlossaryValue = string | { ru: string; feed?: string };

interface ParsedGlossary {
  /** EN (lowercased) → canonical RU. */
  terms: ReadonlyMap<string, string>;
  /** EN (lowercased) → engine-facing surrogate, only for terms that need one. */
  feeds: ReadonlyMap<string, string>;
}

let cached: ParsedGlossary | null = null;

/** Parse `data/glossary.json5` into the terms + feeds maps (cached across calls). */
async function loadParsed(): Promise<ParsedGlossary> {
  if (cached) return cached;

  let raw: string;
  try {
    raw = await readFile(glossaryPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      cached = { terms: new Map(), feeds: new Map() };
      return cached;
    }
    throw err;
  }

  const parsed = JSON5.parse<Record<string, GlossaryValue>>(raw);
  const terms = new Map<string, string>();
  const feeds = new Map<string, string>();
  for (const [en, value] of Object.entries(parsed)) {
    if (en.startsWith("_")) continue;
    const key = en.toLowerCase();
    if (typeof value === "string") {
      terms.set(key, value);
    } else {
      terms.set(key, value.ru);
      if (value.feed) feeds.set(key, value.feed);
    }
  }
  cached = { terms, feeds };
  return cached;
}

/** Load the glossary as a lowercased EN→RU map (cached across calls). */
export async function loadGlossary(): Promise<ReadonlyMap<string, string>> {
  return (await loadParsed()).terms;
}

/**
 * Load the lowercased EN→feed surrogate map (cached across calls). Empty unless
 * some term carries a `feed` — most don't, so this is usually a tiny map.
 */
export async function loadGlossaryFeeds(): Promise<ReadonlyMap<string, string>> {
  return (await loadParsed()).feeds;
}
