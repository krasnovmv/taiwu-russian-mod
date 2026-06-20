/**
 * Match glossary terms against a source text.
 *
 * With the native-glossary approach, terms are no longer substituted locally —
 * they are handed to the engine (Yandex's `glossaryConfig`, or the LM Studio
 * prompt) so it can apply them *and inflect them to fit grammar*. Two consumers
 * share this matcher:
 *
 *  - the engines, to build the per-request set of pairs to enforce;
 *  - the {@link CachingEngine}, to fold the applicable terms into its cache key
 *    so editing a term re-translates only the texts that contain it (texts with
 *    no glossary term keep `key === text`, preserving their cache across edits).
 */

/** A glossary term present in a text: EN source → canonical RU. */
export interface GlossaryMatch {
  en: string;
  ru: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive, longest-match-first whole-word alternation of EN terms. */
function termsRegex(glossary: ReadonlyMap<string, string>): RegExp {
  const terms = [...glossary.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(`\\b(?:${terms.join("|")})\\b`, "gi");
}

/**
 * The glossary entries whose EN term occurs (as a whole word, case-insensitively)
 * in `text`, deduplicated and sorted by term for a deterministic order.
 */
export function matchGlossary(
  text: string,
  glossary: ReadonlyMap<string, string>,
): GlossaryMatch[] {
  if (glossary.size === 0) return [];
  const found = new Map<string, string>();
  for (const m of text.matchAll(termsRegex(glossary))) {
    const en = m[0].toLowerCase();
    const ru = glossary.get(en);
    if (ru !== undefined) found.set(en, ru);
  }
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([en, ru]) => ({ en, ru }));
}

/**
 * A stable signature of the glossary terms that apply to a text. Empty string
 * when none apply (so the cache key collapses to the bare text). Changing a
 * term's RU value changes this signature, invalidating only affected texts.
 */
export function glossarySignature(matches: readonly GlossaryMatch[]): string {
  return matches.map((m) => `${m.en}=${m.ru}`).join("");
}
