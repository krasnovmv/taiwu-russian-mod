/**
 * Format adapter for the paired-`.txt` files (the bulk of the game text).
 * Thin wrapper over {@link parsePairs} and {@link buildTranslatedContent}.
 */
import type { ApplyOutcome, ExtractResult, FormatAdapter, SourceUnit } from "./adapter.js";
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
    const units: SourceUnit[] = [];
    for (const entry of enParsed.entries) {
      const key = entry.key.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      units.push({ key, en: entry.value, cn: cnMap.has(key) ? (cnMap.get(key) ?? null) : null });
    }
    // Keys that exist only in CN (a newer game string the EN pack lacks) are
    // still translated: emit them as `zh`-source units with the Chinese as the
    // source text. They carry no separate CN reference (it would equal the
    // source) so the EN==CN "neutral" heuristic never fires. `apply` appends
    // them to the output file. `onlyCn` stays empty — nothing is dropped.
    for (const [key, cn] of cnMap) {
      if (seen.has(key)) continue;
      seen.add(key);
      units.push({ key, en: cn, cn: null, srcLang: "zh" });
    }
    return { units, onlyCn: [], warnings: enParsed.warnings };
  },

  apply(enContent, translations): ApplyOutcome {
    return buildTranslatedContent(enContent, translations);
  },
};
