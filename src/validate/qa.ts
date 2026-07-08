/**
 * Quality checks over translated units in the TM. Read-only; reports issues so
 * a human can review before applying to the game.
 *
 * Checks per translated unit (ru != null):
 *   - markup parity: tags/placeholders in RU must match EN exactly
 *   - escape mangle: the translation must not break a backslash escape that was
 *                    intact in EN — the engine drops the char after a backslash
 *                    (\n -> "\Хаос", > -> "\u003 "). Flagged when RU has more
 *                    mangled escapes than EN, or a changed \n line-break count;
 *                    escapes already broken in the EN source are not the
 *                    translation's fault and are not flagged.
 *   - newline hazard: RU must not contain a real newline (would break alternation)
 *   - empty output:   non-empty EN must not translate to empty RU
 *   - untranslated:   RU equal to EN for text that contained letters (informational
 *                     while translation is incomplete — the CLI never fails on it)
 *   - length anomaly: RU wildly shorter/longer than EN (heuristic; skipped when
 *                     the EN field is actually Chinese — CJK density makes the
 *                     ratio meaningless)
 */
import type { SourceUnit } from "../formats/adapter.js";
import { extractMarkup, markupPreserved } from "../engine/protect.js";
import type { TmFile } from "../model/tm.js";

export type IssueKind =
  | "markup-mismatch"
  | "escape-mismatch"
  | "newline-hazard"
  | "empty-output"
  | "untranslated"
  | "length-anomaly"
  | "cn-divergence";

export interface QaIssue {
  file: string;
  key: string;
  kind: IssueKind;
  detail: string;
}

const LENGTH_MIN_RATIO = 0.2;
const LENGTH_MAX_RATIO = 6;
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
// backslashes in RU than EN, or a changed `\n` count. The game's own EN source
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

/** Count literal `\n` line-break markers (well-formed escapes only). */
function newlineMarkers(s: string): number {
  return (s.match(VALID_ESCAPE_RE) ?? []).filter((e) => e === "\\n").length;
}

export function validateTm(tm: TmFile): QaIssue[] {
  const issues: QaIssue[] = [];
  const push = (key: string, kind: IssueKind, detail: string): void => {
    issues.push({ file: tm.file, key, kind, detail });
  };

  for (const [key, unit] of Object.entries(tm.units)) {
    const { en, ru } = unit;
    if (ru == null) continue;

    if (!markupPreserved(en, ru)) {
      const enMarkup = extractMarkup(en);
      const ruMarkup = extractMarkup(ru);
      push(key, "markup-mismatch", `EN[${enMarkup.join(" ")}] vs RU[${ruMarkup.join(" ")}]`);
    }

    const enMangled = countMangled(en);
    const ruMangled = countMangled(ru);
    const enNl = newlineMarkers(en);
    const ruNl = newlineMarkers(ru);
    if (ruMangled > enMangled) {
      const mangled = ru.match(MANGLED_ESCAPE_RE) ?? [];
      push(key, "escape-mismatch", `mangled escape(s): ${mangled.map((m) => JSON.stringify(m)).join(" ")}`);
    } else if (enNl !== ruNl) {
      // No new stray backslash, but the engine still lost (or invented) a `\n`
      // line-break marker — e.g. it deleted the whole token cleanly.
      push(key, "escape-mismatch", `\\n count: EN=${enNl} RU=${ruNl}`);
    }

    if (/[\r\n]/.test(ru)) push(key, "newline-hazard", "RU contains a real newline");

    if (en.trim() !== "" && ru.trim() === "") push(key, "empty-output", "EN non-empty, RU empty");

    if (hasLetters(en) && en === ru) push(key, "untranslated", "RU identical to EN");

    if (en.length >= LENGTH_MIN_CHARS && ru.length > 0 && !hasCjk(en)) {
      const ratio = ru.length / en.length;
      if (ratio < LENGTH_MIN_RATIO || ratio > LENGTH_MAX_RATIO) {
        push(key, "length-anomaly", `ratio ${ratio.toFixed(2)} (en=${en.length}, ru=${ru.length})`);
      }
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
