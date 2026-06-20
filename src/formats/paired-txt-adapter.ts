/**
 * Format adapter for the paired-`.txt` files (the bulk of the game text).
 * Thin wrapper over {@link parsePairs} and {@link buildTranslatedContent}.
 */
import type { ApplyOutcome, ExtractResult, FormatAdapter } from "./adapter.js";
import { parsePairs } from "./paired-txt.js";
import { buildTranslatedContent } from "./paired-txt-build.js";

function indexByKey(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of parsePairs(content).entries) {
    const key = entry.key.trim();
    if (!map.has(key)) map.set(key, entry.value); // first occurrence wins
  }
  return map;
}

export const pairedTxtAdapter: FormatAdapter = {
  id: "paired-txt",

  extract(enContent, cnContent): ExtractResult {
    const enParsed = parsePairs(enContent);
    const cnMap = cnContent ? indexByKey(cnContent) : new Map<string, string>();

    const seen = new Set<string>();
    const units = [];
    for (const entry of enParsed.entries) {
      const key = entry.key.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      units.push({ key, en: entry.value, cn: cnMap.has(key) ? (cnMap.get(key) ?? null) : null });
    }
    const onlyCn = [...cnMap.keys()].filter((k) => !seen.has(k));
    return { units, onlyCn, warnings: enParsed.warnings };
  },

  apply(enContent, translations): ApplyOutcome {
    return buildTranslatedContent(enContent, translations);
  },
};
