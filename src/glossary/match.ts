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
  /**
   * An engine-facing surrogate for {@link en}, when the raw term confuses the
   * MT engine. Yandex treats the period in an abbreviation like `Phy.` as a
   * sentence boundary, which splits a multi-word term (`Phy. Penetration`) and
   * defeats the neuroglossary; feeding a dot-free form (`Physical Penetration`)
   * instead restores matching *and* declension. See `applyGlossaryFeeds`.
   */
  feed?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A term's whole-word pattern. `\b` anchors are applied only against the term's
 * word-character edges: a term that ends in punctuation (`Res.`, `Lv.`) gets no
 * trailing `\b`, since after a period the boundary exists only before a word
 * character — `\bRes\.\b` would match `Res.1` but never `Res.-100` or `Res. `.
 */
function termPattern(term: string): string {
  const lead = /^\w/.test(term) ? "\\b" : "";
  const trail = /\w$/.test(term) ? "\\b" : "";
  return `${lead}${escapeRegExp(term)}${trail}`;
}

/**
 * Case-insensitive, longest-match-first whole-word alternation of EN terms.
 *
 * Compiling a 200+-term alternation is expensive and {@link matchGlossary} runs
 * once per translation unit (hundreds of thousands per rebuild), so the compiled
 * regex is memoized per glossary map. `matchAll` clones the regex's state, so a
 * shared instance is safe to reuse across calls.
 */
const termsRegexCache = new WeakMap<ReadonlyMap<string, string>, RegExp>();
function termsRegex(glossary: ReadonlyMap<string, string>): RegExp {
  const cached = termsRegexCache.get(glossary);
  if (cached) return cached;
  const terms = [...glossary.keys()].sort((a, b) => b.length - a.length).map(termPattern);
  const re = new RegExp(`(?:${terms.join("|")})`, "gi");
  termsRegexCache.set(glossary, re);
  return re;
}

/**
 * The glossary entries whose EN term occurs (as a whole word, case-insensitively)
 * in `text`, deduplicated and sorted by term for a deterministic order. When
 * `feeds` is given, a matched term's engine-facing surrogate (see
 * {@link GlossaryMatch.feed}) is attached.
 */
export function matchGlossary(
  text: string,
  glossary: ReadonlyMap<string, string>,
  feeds?: ReadonlyMap<string, string>,
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
    .map(([en, ru]) => {
      const feed = feeds?.get(en);
      return feed ? { en, ru, feed } : { en, ru };
    });
}

/**
 * Rewrite `text` so each matched glossary term carrying a {@link
 * GlossaryMatch.feed} surrogate is replaced by that surrogate — the form handed
 * to the MT engine. A no-op when no feeds apply, so the engine sends the text
 * verbatim. MUST be paired with feeding the same surrogate as the glossary
 * pair's source term (see `glossaryPairsForTexts`), or the engine sees the
 * surrogate in the text but a different key in the glossary and matches neither.
 */
export function applyGlossaryFeeds(
  text: string,
  glossary: ReadonlyMap<string, string>,
  feeds?: ReadonlyMap<string, string>,
): string {
  if (!feeds || feeds.size === 0) return text;
  let out = text;
  for (const { en, feed } of matchGlossary(text, glossary, feeds)) {
    if (!feed || feed === en) continue;
    out = out.replace(new RegExp(termPattern(en), "gi"), feed);
  }
  return out;
}

/**
 * A stable signature of the glossary terms that apply to a text. Empty string
 * when none apply (so the cache key collapses to the bare text). Changing a
 * term's RU value — or its engine-facing `feed` surrogate — changes this
 * signature, invalidating only affected texts.
 */
export function glossarySignature(matches: readonly GlossaryMatch[]): string {
  // Fold `feed` in: adding/changing a term's surrogate changes the text sent to
  // the engine, so its cached output must be invalidated like an RU-value edit.
  return matches.map((m) => (m.feed ? `${m.en}=${m.ru}>${m.feed}` : `${m.en}=${m.ru}`)).join("");
}
