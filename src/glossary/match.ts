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
  /** The glossary map key: lowercased for case-insensitive terms, verbatim for `cs` terms. */
  en: string;
  ru: string;
  /**
   * The term as it actually appears in the text (first occurrence's casing),
   * e.g. `True Qi` for the lowercased key `true qi`. Engines that echo the term
   * back to the MT service (Yandex's `sourceText`) use this form so the pair
   * matches the request text even if the service compares case-sensitively.
   * NOT part of {@link glossarySignature} — cache keys must not vary with the
   * casing a term happens to have in a given text.
   */
  src: string;
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
 * A glossary map key's own case marks its matching mode: the loader lowercases
 * case-insensitive terms and keeps `cs: true` terms verbatim (they must carry
 * an uppercase letter), so no separate flag travels with the map.
 */
export function isCaseSensitiveKey(key: string): boolean {
  return key !== key.toLowerCase();
}

/**
 * Longest-match-first whole-word alternations of the EN terms: one
 * case-insensitive regex for lowercased keys, one case-sensitive for `cs` keys
 * (either may be null when its set is empty).
 *
 * Compiling a 200+-term alternation is expensive and {@link matchGlossary} runs
 * once per translation unit (hundreds of thousands per rebuild), so the compiled
 * pair is memoized per glossary map. `matchAll` clones the regex's state, so a
 * shared instance is safe to reuse across calls.
 */
interface TermsRegexes {
  ci: RegExp | null;
  cs: RegExp | null;
}
const termsRegexCache = new WeakMap<ReadonlyMap<string, string>, TermsRegexes>();
function termsRegexes(glossary: ReadonlyMap<string, string>): TermsRegexes {
  const cached = termsRegexCache.get(glossary);
  if (cached) return cached;
  const keys = [...glossary.keys()].sort((a, b) => b.length - a.length);
  const compile = (terms: string[], flags: string): RegExp | null =>
    terms.length > 0 ? new RegExp(`(?:${terms.map(termPattern).join("|")})`, flags) : null;
  const res: TermsRegexes = {
    ci: compile(keys.filter((k) => !isCaseSensitiveKey(k)), "gi"),
    cs: compile(keys.filter(isCaseSensitiveKey), "g"),
  };
  termsRegexCache.set(glossary, res);
  return res;
}

/**
 * The glossary entries whose EN term occurs (as a whole word — case-insensitively
 * for lowercased keys, exactly for `cs` keys) in `text`, deduplicated and sorted
 * by term for a deterministic order. When `feeds` is given, a matched term's
 * engine-facing surrogate (see {@link GlossaryMatch.feed}) is attached.
 *
 * Candidates from both regexes are merged leftmost-longest, mirroring what a
 * single alternation does: `Attack Speed` (ci) still consumes the embedded
 * `Attack` (cs), so splitting the regexes changes no ci-only signature.
 */
export function matchGlossary(
  text: string,
  glossary: ReadonlyMap<string, string>,
  feeds?: ReadonlyMap<string, string>,
): GlossaryMatch[] {
  if (glossary.size === 0) return [];
  const { ci, cs } = termsRegexes(glossary);
  const candidates: { index: number; key: string; src: string }[] = [];
  if (ci) {
    for (const m of text.matchAll(ci)) {
      candidates.push({ index: m.index, key: m[0].toLowerCase(), src: m[0] });
    }
  }
  if (cs) {
    for (const m of text.matchAll(cs)) {
      candidates.push({ index: m.index, key: m[0], src: m[0] });
    }
  }
  candidates.sort((a, b) => a.index - b.index || b.src.length - a.src.length);

  const found = new Map<string, GlossaryMatch>();
  let cursor = 0;
  for (const c of candidates) {
    if (c.index < cursor) continue; // overlapped by an earlier, longer match
    cursor = c.index + c.src.length;
    if (found.has(c.key)) continue; // keep the first occurrence's casing
    const ru = glossary.get(c.key);
    if (ru !== undefined) found.set(c.key, { en: c.key, ru, src: c.src });
  }
  return [...found.values()]
    .sort((a, b) => a.en.localeCompare(b.en))
    .map((match) => {
      const feed = feeds?.get(match.en);
      return feed ? { ...match, feed } : match;
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
    out = out.replace(new RegExp(termPattern(en), isCaseSensitiveKey(en) ? "g" : "gi"), feed);
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
