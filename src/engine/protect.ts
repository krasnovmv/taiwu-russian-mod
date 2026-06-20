/**
 * Markup protection — the safety-critical layer.
 *
 * Game values embed markup that MUST survive translation verbatim:
 *   - C# placeholders:     {0} {1} {2}
 *   - Unity rich text:     <color=#brightred> </color> <align=right> <line-height=0>
 *   - Game tags:           <NL> <Character key=RoleTaiwu str=GenderSubject/>
 *
 * Strategy: replace every protected span (and optional glossary terms) with an
 * opaque sentinel before translation, then restore by index afterwards. The
 * restore step VALIDATES that every sentinel survived exactly once — if the
 * engine dropped, duplicated or mangled a sentinel, restore fails and the caller
 * flags the unit instead of writing corrupted text.
 *
 * Sentinels use rare mathematical white square brackets ⟦n⟧ (U+27E6/U+27E7),
 * which machine translators reliably pass through and which never occur in the
 * source data.
 */

/** Matches any `<…>` tag, including `<NL>`, `<color=#x>`, `<Character …/>`. */
const TAG_RE = /<[^>]+>/g;
/** Matches C# format placeholders like `{0}`. */
const PLACEHOLDER_RE = /\{\d+\}/g;

const SENTINEL_RE = /⟦(\d+)⟧/g;
const sentinel = (index: number): string => `⟦${index}⟧`;

export interface Masked {
  /** Source with protected spans replaced by sentinels, whitespace-trimmed. */
  readonly masked: string;
  /** Original spans, indexed by sentinel number. */
  readonly tokens: readonly string[];
  /** Leading whitespace stripped from the source (re-attached on restore). */
  readonly leading: string;
  /** Trailing whitespace stripped from the source. */
  readonly trailing: string;
  /** True when `masked` contains no translatable letters (engine can be skipped). */
  readonly translatable: boolean;
}

/**
 * Mask protected spans (and glossary terms) in `text`.
 *
 * @param glossary lowercased EN term → canonical RU term. Matched terms are
 *   replaced by a sentinel whose restore value is the RU term, guaranteeing
 *   consistent terminology regardless of the engine.
 */
export function mask(text: string, glossary: ReadonlyMap<string, string> = new Map()): Masked {
  const leading = /^\s*/.exec(text)?.[0] ?? "";
  const trailing = text.length > leading.length ? (/\s*$/.exec(text)?.[0] ?? "") : "";
  const core = text.slice(leading.length, text.length - trailing.length);

  const tokens: string[] = [];
  const replace = (input: string, re: RegExp, value: (match: string) => string): string =>
    input.replace(re, (match) => {
      const index = tokens.length;
      tokens.push(value(match));
      return sentinel(index);
    });

  // Order matters: tags first (so a glossary term inside a tag is not touched),
  // then placeholders, then glossary. Sentinels never match the later regexes.
  let masked = replace(core, TAG_RE, (m) => m);
  masked = replace(masked, PLACEHOLDER_RE, (m) => m);
  if (glossary.size > 0) {
    masked = replace(masked, glossaryRegex(glossary), (m) => glossary.get(m.toLowerCase()) ?? m);
  }

  const translatable = /\p{L}/u.test(masked);
  return { masked, tokens, leading, trailing, translatable };
}

export interface RestoreResult {
  readonly ok: boolean;
  /** Fully restored text (only meaningful when `ok`). */
  readonly text: string;
  /** Human-readable reason when `ok` is false. */
  readonly error?: string;
}

/**
 * Restore sentinels in `translated` back to their original spans and re-attach
 * whitespace. Returns `ok: false` (never throws) if validation fails, so the
 * caller can flag the unit without aborting a batch.
 */
export function restore(translated: string, m: Masked): RestoreResult {
  const seen = new Array<number>(m.tokens.length).fill(0);
  let bad: string | undefined;

  const body = translated.replace(SENTINEL_RE, (whole, digits: string) => {
    const index = Number(digits);
    if (index >= m.tokens.length) {
      bad ??= `unknown sentinel ${whole}`;
      return whole;
    }
    seen[index] = (seen[index] ?? 0) + 1;
    return m.tokens[index] ?? "";
  });

  if (bad) return { ok: false, text: "", error: bad };
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] !== 1) {
      return {
        ok: false,
        text: "",
        error: `sentinel ⟦${i}⟧ appears ${seen[i]} time(s), expected 1`,
      };
    }
  }
  return { ok: true, text: m.leading + body + m.trailing };
}

/**
 * Extract the sorted multiset of markup tokens (tags + placeholders) in a
 * string. Used by QA to assert EN and RU carry identical markup.
 */
export function extractMarkup(text: string): string[] {
  const found = [...(text.match(TAG_RE) ?? []), ...(text.match(PLACEHOLDER_RE) ?? [])];
  return found.sort();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a case-insensitive, longest-match-first alternation of glossary terms. */
function glossaryRegex(glossary: ReadonlyMap<string, string>): RegExp {
  const terms = [...glossary.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(`\\b(?:${terms.join("|")})\\b`, "gi");
}
