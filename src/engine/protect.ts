/**
 * Markup protection — the safety-critical layer.
 *
 * Game values embed markup that MUST survive translation verbatim:
 *   - C# placeholders:     {0} {1} {2}
 *   - Unity rich text:     <color=#brightred> </color> <align=right> <line-height=0>
 *   - Game tags:           <NL> <Character key=RoleTaiwu str=GenderSubject/>
 *   - literal escapes:     \n (line break) and \uXXXX code points (e.g. <
 *                          > = < > forming `<color=…>` tags). These are NOT
 *                          real `<…>` tags — they are backslash-escape TEXT the
 *                          engine loves to mangle (drops the char after the
 *                          backslash: \n -> "\Хаос", > -> "\u003 "). Masking
 *                          them makes that corruption structurally impossible.
 *
 * Strategy: replace every protected span with an opaque sentinel before
 * translation, then restore by index afterwards. (Glossary terms are NOT masked
 * here — they are passed to the engine to apply and inflect; see
 * `src/glossary/match.ts`.) The
 * restore step VALIDATES that every sentinel survived exactly once — if the
 * engine dropped, duplicated or mangled a sentinel, restore fails and the caller
 * flags the unit instead of writing corrupted text.
 *
 * Sentinels are empty paired tags `<mN></mN>`. Yandex's HTML translation mode
 * passes them through verbatim (no spacing/attribute changes), and an LLM keeps
 * them as opaque tokens — both far more reliable than bracket characters, which
 * Yandex sometimes mangles. They never occur in the source data.
 */

/** Matches any `<…>` tag, including `<NL>`, `<color=#x>`, `<Character …/>`. */
const TAG_RE = /<[^>]+>/g;
/** Matches C# format placeholders like `{0}`. */
const PLACEHOLDER_RE = /\{\d+\}/g;
/** Matches literal game escapes: `\uXXXX` code points and `\n`/`\r`/`\t`. */
const ESCAPE_RE = /\\u[0-9a-fA-F]{4}|\\[nrt]/g;

// Empty paired tags `<mN></mN>` survive Yandex's HTML translation mode verbatim
// (no spacing, no attribute "normalisation"), unlike ⟦⟧ in plain text — which
// Yandex sometimes mangles — or self-closing `<mN/>`, which it pads with a space.
const SENTINEL_RE = /<m(\d+)><\/m\1>/g;
const sentinel = (index: number): string => `<m${index}></m${index}>`;

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

/** Mask protected spans (tags + placeholders) in `text`. */
export function mask(text: string): Masked {
  const leading = /^\s*/.exec(text)?.[0] ?? "";
  const trailing = text.length > leading.length ? (/\s*$/.exec(text)?.[0] ?? "") : "";
  const core = text.slice(leading.length, text.length - trailing.length);

  const tokens: string[] = [];
  const replace = (input: string, re: RegExp): string =>
    input.replace(re, (match) => {
      const index = tokens.length;
      tokens.push(match);
      return sentinel(index);
    });

  // Tags first (so a placeholder inside a tag is not double-masked), then
  // placeholders, then literal escapes. Order is safe because the sets don't
  // overlap (escapes are backslash TEXT, tags/placeholders are real `<…>`/`{n}`)
  // and sentinels — which carry no backslash — never match a later regex.
  let masked = replace(core, TAG_RE);
  masked = replace(masked, PLACEHOLDER_RE);
  masked = replace(masked, ESCAPE_RE);

  // Sentinels contain a literal "m"; strip them before checking for real letters.
  const translatable = /\p{L}/u.test(masked.replace(SENTINEL_RE, ""));
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
        error: `sentinel <m${i}> appears ${seen[i]} time(s), expected 1`,
      };
    }
  }
  // Markup parity: the restored text must carry exactly the source's markup and
  // nothing the engine invented (stray `<m1>`, `<mo>`, `<0>`, Cyrillic `<м1>`,
  // dropped/extra tags). Reconstruct the source and use the SAME predicate as QA
  // (markupPreserved) so the translate-time and validate-time checks can't drift.
  const source = m.masked.replace(SENTINEL_RE, (_w, d: string) => m.tokens[Number(d)] ?? "");
  if (!markupPreserved(source, body)) {
    return {
      ok: false,
      text: "",
      error: `markup changed: [${extractMarkup(source).join(" ")}] vs [${extractMarkup(body).join(" ")}]`,
    };
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

/**
 * True when two strings carry exactly the same markup multiset (tags +
 * placeholders, order-independent). The single source of markup-parity truth,
 * shared by: the cache (masked input vs engine output — a mismatch means the
 * engine mangled markup, so the result must not be cached), `restore`
 * (source vs restored output), and QA (`en` vs `ru`). Keeping one predicate
 * means those checks can never drift apart.
 */
export function markupPreserved(a: string, b: string): boolean {
  const ma = extractMarkup(a);
  const mb = extractMarkup(b);
  return ma.length === mb.length && ma.every((t, i) => t === mb[i]);
}
