/**
 * Quality checks over translated units in the TM. Read-only; reports issues so
 * a human can review before applying to the game.
 *
 * Checks per translated unit (ru != null):
 *   - markup parity: tags/placeholders in RU must match EN exactly
 *   - escape mangle: the translation must not break a backslash escape that was
 *                    intact in EN — the engine drops the char after a backslash
 *                    (\n -> "\Хаос", > -> "\u003 "). Flagged when RU has more
 *                    mangled escapes than EN, or a changed count of any escape
 *                    token (\n, \t, \", \\); escapes already broken in the EN
 *                    source are not the translation's fault and are not flagged.
 *   - newline hazard: RU must contain exactly as many real newlines as EN
 *                     (extra/missing ones would break alternation)
 *   - empty output:   non-empty EN must not translate to empty RU
 *   - untranslated:   RU equal to EN for text that contained letters (informational
 *                     while translation is incomplete — the CLI never fails on it)
 *   - chinese in RU:  hanzi left in the Russian — the CN original leaking through
 *                     an untranslated name or a copied reference block
 *   - length anomaly: RU wildly SHORTER than EN (likely dropped content)
 *   - length bloat:   RU much LONGER than EN (> 2×) — an English-sized UI box
 *                     clips the overflow with an ellipsis, so text is lost
 *   (both skipped when the EN field is actually Chinese — CJK density makes the
 *   ratio meaningless)
 */
import type { SourceUnit } from "../formats/adapter.js";
import { extractMarkup, markupPreserved, stripMarkup } from "../engine/protect.js";
import type { GlossaryMatch } from "../glossary/match.js";
import type { TmFile } from "../model/tm.js";

export type IssueKind =
  | "markup-mismatch"
  | "escape-mismatch"
  | "newline-hazard"
  | "empty-output"
  | "untranslated"
  | "length-anomaly"
  | "length-bloat"
  | "latin-in-russian"
  | "chinese-in-russian"
  | "special-char-loss"
  | "glossary-miss"
  | "cn-divergence";

export interface QaIssue {
  file: string;
  key: string;
  kind: IssueKind;
  detail: string;
}

const LENGTH_MIN_RATIO = 0.2;
// RU beyond this multiple of the EN length is "much longer": the UI is laid out
// for English widths, so an overlong Russian string is clipped with an ellipsis
// and part of it is lost. Russian runs ~1.1× English on the median and 1.9× at
// the 99th percentile (corpus audit 2026-07-15), so 2× flags the genuinely
// bloated tail (~0.6% of units) without catching normal expansion.
const LENGTH_BLOAT_RATIO = 2;
const LENGTH_MIN_CHARS = 12; // ignore ratio checks on very short strings

function hasLetters(s: string): boolean {
  return /\p{L}/u.test(s);
}

// Some units ship untranslated Chinese in the `en` field (upstream never made an
// EN version). That's legitimate source text, but CJK is far denser than Russian
// (one hanzi ≈ a whole RU word), so the EN↔RU length ratio is meaningless there.
function hasCjk(s: string): boolean {
  return /\p{Script=Han}/u.test(s);
}

// The game text embeds literal backslash escapes that must survive verbatim:
//   - `\n`           line break inside a cell
//   - `\uXXXX`       a code point (e.g. `<`/`>` = `<`/`>`, forming
//                    `<color=…>` rich-text tags) — NOT a real `<…>` tag, so the
//                    markup check above never sees it
// (plus the occasional `\\` and `\"`). The MT engine corrupts these by dropping
// the char after the backslash, leaving a bare/garbled backslash that breaks
// rendering — observed in the wild as `\n` -> "\Хаос" and `>` -> "\u003 ".
// Any backslash that is not one of these well-formed forms is mangled.
//
// We flag a unit only when the TRANSLATION introduced the breakage: more mangled
// backslashes in RU than EN, or a changed escape-token count. The game's own EN source
// occasionally ships a pre-broken escape (e.g. "time? \I was" — a dropped `\n`);
// a translation that faithfully mirrors it is not at fault, so comparing against
// EN keeps those upstream-data issues out of the report.
const VALID_ESCAPE_RE = /\\(?:n|t|"|\\|u[0-9a-fA-F]{4})/g;
// Backslash NOT starting a valid escape, plus a little trailing context for the
// report (`\Хаос` -> "\Хао", a dangling `\u003 ` -> "\u003 ").
const MANGLED_ESCAPE_RE = /\\(?!n|t|"|\\|u[0-9a-fA-F]{4}).{0,4}/g;

function countMangled(s: string): number {
  return (s.match(MANGLED_ESCAPE_RE) ?? []).length;
}

// Escape tokens whose count must survive translation verbatim. `\uXXXX` is
// deliberately absent: those encode ordinary characters (often punctuation,
// e.g. `,` = comma) that a translation may legitimately drop or add;
// corruption of a `\u` sequence is still caught by the mangled check.
const COUNTED_ESCAPES = ["\\n", "\\t", '\\"', "\\\\"] as const;

/** Count each well-formed escape token that must be preserved verbatim. */
function escapeCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>(COUNTED_ESCAPES.map((t) => [t, 0]));
  for (const m of s.match(VALID_ESCAPE_RE) ?? []) {
    const n = counts.get(m);
    if (n !== undefined) counts.set(m, n + 1);
  }
  return counts;
}

/** Count real (unescaped) newline characters. */
function realNewlines(s: string): number {
  return (s.match(/[\r\n]/g) ?? []).length;
}

// A run of Latin letters left in the Russian output (once markup is stripped).
// Wuxia game text has no reason to keep English words — they are either an
// untranslated leftover (DMG, XP, Encounter, an item name like `Pixiu`) or a
// corrupted token (`lackеев`).
const LATIN_RUN_RE = /[A-Za-z]{2,}|[A-Za-z](?=[Ѐ-ӿ])|(?<=[Ѐ-ӿ])[A-Za-z]/g;

// The bare code literals `true`/`false`/`null` are the one Latin that may be
// load-bearing: some game/AI-condition text prints a boolean the engine keys on,
// so translating it could break logic. Exempted (lowercase form only — a
// capitalised `True` mid-sentence is prose, not a literal) pending an explicit
// decision to translate them too.
const CODE_LITERALS = new Set(["true", "false", "null"]);

/** Latin runs remaining in `ru` after markup is stripped, minus code literals. */
function latinLeftovers(ru: string): string[] {
  return (stripMarkup(ru).match(LATIN_RUN_RE) ?? []).filter((run) => !CODE_LITERALS.has(run));
}

// Hanzi left in the Russian output (once markup is stripped). Unlike Latin there
// is no exempt form: a Chinese character in a Russian string is always a defect —
// either a name the engine gave up on, or the CN reference leaking in from the
// judge's prompt. Names belong in Cyrillic transliteration.
const HAN_RUN_RE = /\p{Script=Han}+/gu;

/**
 * Runs of Chinese characters remaining in `ru` after markup is stripped. Exported
 * because the translation pipeline gates engine output on it too — one definition
 * of "hanzi leaked into the Russian" for the writer and the reporter alike.
 */
export function chineseLeftovers(ru: string): string[] {
  return stripMarkup(ru).match(HAN_RUN_RE) ?? [];
}

// Literal symbol characters that carry meaning and must survive translation
// verbatim: brackets wrap keyword markers, quotes wrap quoted tips, `%`/`$` guard
// game stats/format tokens. Their EN and RU counts must match once markup is
// stripped. Chosen from a corpus-wide audit (2026-07-15): the bracket/symbol set
// mismatches < 2% of the time (translation preserves it). Deliberately EXCLUDED
// because translation legitimately changes them (audited 36–98% mismatch):
// sentence dashes and commas (`, - —`), the apostrophe (`'`, no Russian form),
// and `&` — which Yandex correctly renders as the word «и». The straight quote `"`
// is the one high-mismatch (37%) character we still guard: a dropped quote around
// a tip IS a defect, not a translation choice, and it is the case that started this.
const SPECIAL_CHARS = [...'"()[]{}<>%#$^~|*+='];

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** EN special characters whose count changed in RU (markup stripped from both). */
function specialCharDiffs(en: string, ru: string): string[] {
  // Strip markup AND backslash-escapes: an escaped quote `\"` (or `\\`) is owned
  // by the escape-mismatch check, so counting the bare `"` inside it here would
  // double-flag the same defect. What remains are the source's LITERAL symbols.
  const e = stripMarkup(en).replace(/\\./gs, "");
  const r = stripMarkup(ru).replace(/\\./gs, "");
  const diffs: string[] = [];
  for (const ch of SPECIAL_CHARS) {
    const ce = countChar(e, ch);
    if (ce === 0) continue; // only guard characters the source actually has
    const cr = countChar(r, ch);
    if (ce !== cr) diffs.push(`${ch} EN=${ce} RU=${cr}`);
  }
  return diffs;
}

/**
 * Glossary terms the translation ignored: each matched term's mandated Russian
 * value should appear (declined) in `ru`. We check the value's HEAD noun — its
 * last word in Russian noun phrases — by a stem match (case-insensitive, the last
 * couple of letters dropped so declension still passes). Lenient by design: it
 * catches a wholesale swap (glossary says `лун`, translation says `дракон`) while
 * letting any grammatical form of the right word through. Never reintroduces
 * case-sensitive term *matching* — that was tried and reverted; this is a
 * value-side check on the output, always case-insensitive.
 */
export function glossaryMisses(ru: string, matches: readonly GlossaryMatch[]): TranslationIssue[] {
  const haystack = ru.toLowerCase();
  const issues: TranslationIssue[] = [];
  for (const m of matches) {
    const words = m.ru.toLowerCase().split(/\s+/).filter(Boolean);
    const head = words[words.length - 1];
    if (!head) continue;
    const stem = head.slice(0, Math.max(3, head.length - 2));
    if (!haystack.includes(stem)) {
      issues.push({ kind: "glossary-miss", detail: `${m.en} → ${m.ru} (stem "${stem}" absent)` });
    }
  }
  return issues;
}

/** An issue found in one translation, before it is attributed to a file/key. */
export type TranslationIssue = Pick<QaIssue, "kind" | "detail">;

/**
 * Every check we make on a single EN→RU pair, in one place.
 *
 * The SINGLE source of translation-validity truth, shared by {@link validateTm}
 * (the QA report) and the LLM judge (which refuses to write a rewrite that fails
 * any of these). Keeping one function means the judge can never write something
 * `npm run validate` would then flag.
 */
export function checkTranslation(en: string, ru: string): TranslationIssue[] {
  const issues: TranslationIssue[] = [];
  const push = (kind: IssueKind, detail: string): void => void issues.push({ kind, detail });

  if (!markupPreserved(en, ru)) {
    const enMarkup = extractMarkup(en);
    const ruMarkup = extractMarkup(ru);
    push("markup-mismatch", `EN[${enMarkup.join(" ")}] vs RU[${ruMarkup.join(" ")}]`);
  }

  const enMangled = countMangled(en);
  const ruMangled = countMangled(ru);
  if (ruMangled > enMangled) {
    const mangled = ru.match(MANGLED_ESCAPE_RE) ?? [];
    push(
      "escape-mismatch",
      `mangled escape(s): ${mangled.map((m) => JSON.stringify(m)).join(" ")}`,
    );
  } else {
    // No new stray backslash, but the engine may still have lost (or
    // invented) a whole escape token cleanly — e.g. deleted a `\n` marker.
    const enEsc = escapeCounts(en);
    const ruEsc = escapeCounts(ru);
    const diffs = COUNTED_ESCAPES.filter((t) => enEsc.get(t) !== ruEsc.get(t));
    if (diffs.length > 0) {
      const detail = diffs
        .map((t) => `${t} count: EN=${enEsc.get(t)} RU=${ruEsc.get(t)}`)
        .join(", ");
      push("escape-mismatch", detail);
    }
  }

  // Real newlines are fine only where the EN source already has them — a
  // translation that adds or drops one breaks the file's line structure.
  const enRealNl = realNewlines(en);
  const ruRealNl = realNewlines(ru);
  if (ruRealNl !== enRealNl) {
    push("newline-hazard", `real newlines: EN=${enRealNl} RU=${ruRealNl}`);
  }

  if (en.trim() !== "" && ru.trim() === "") push("empty-output", "EN non-empty, RU empty");

  if (hasLetters(en) && en === ru) push("untranslated", "RU identical to EN");

  // Latin left in a Russian translation — but not when the RU is just the EN
  // carried through verbatim (a pinyin name, a dev id): that is already reported
  // as `untranslated`, and flagging it again as Latin would double-count it. The
  // same carve-out covers the Chinese check: some units ship a CN `en` field, and
  // an untouched pass-through of one is `untranslated`, not a leak.
  if (en !== ru) {
    const latin = latinLeftovers(ru);
    if (latin.length > 0) push("latin-in-russian", `Latin in RU: ${latin.join(" ")}`);

    const chinese = chineseLeftovers(ru);
    if (chinese.length > 0) push("chinese-in-russian", `Chinese in RU: ${chinese.join(" ")}`);
  }

  // Literal special characters (brackets, quotes, %) the source has but the
  // translation dropped or duplicated — e.g. the wrapping quotes of a quoted tip.
  const scDiffs = specialCharDiffs(en, ru);
  if (scDiffs.length > 0) push("special-char-loss", scDiffs.join(", "));

  if (en.length >= LENGTH_MIN_CHARS && ru.length > 0 && !hasCjk(en)) {
    const ratio = ru.length / en.length;
    if (ratio < LENGTH_MIN_RATIO) {
      // RU suspiciously short: likely dropped content.
      push(
        "length-anomaly",
        `RU too short: ratio ${ratio.toFixed(2)} (en=${en.length}, ru=${ru.length})`,
      );
    } else if (ratio > LENGTH_BLOAT_RATIO) {
      // RU much longer than EN: risks being clipped by an English-sized UI box.
      push(
        "length-bloat",
        `RU is ${ratio.toFixed(1)}× the English (en=${en.length}, ru=${ru.length}); may be clipped in-game`,
      );
    }
  }

  return issues;
}

export function validateTm(tm: TmFile): QaIssue[] {
  const issues: QaIssue[] = [];
  for (const [key, unit] of Object.entries(tm.units)) {
    if (unit.ru == null) continue;
    for (const issue of checkTranslation(unit.en, unit.ru)) {
      issues.push({ file: tm.file, key, ...issue });
    }
  }
  return issues;
}

/**
 * Semantic cross-check against the CN reference: the EN source and CN original
 * should carry the same markup (placeholders, tags). A divergence signals an
 * upstream issue in the machine-made EN text (e.g. a dropped `{0}`), worth
 * reviewing before trusting the translation. Pure markup parity — true meaning
 * checks would need an LLM.
 */
export function validateBilingual(file: string, units: readonly SourceUnit[]): QaIssue[] {
  const issues: QaIssue[] = [];
  for (const unit of units) {
    if (unit.cn === null) continue;
    if (!markupPreserved(unit.en, unit.cn)) {
      const en = extractMarkup(unit.en);
      const cn = extractMarkup(unit.cn);
      issues.push({
        file,
        key: unit.key,
        kind: "cn-divergence",
        detail: `EN[${en.join(" ")}] vs CN[${cn.join(" ")}]`,
      });
    }
  }
  return issues;
}
