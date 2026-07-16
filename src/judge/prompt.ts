/**
 * The judge prompt: what the LLM sees for one translation unit, and how its
 * answer is read back.
 *
 * The design follows MQM (Multidimensional Quality Metrics), the standard used to
 * annotate MT quality, in the shape GEMBA-MQM popularised for LLM judges: the
 * model does not deliver a free-form opinion, it ANNOTATES ERRORS — each with a
 * category and a severity (critical / major / minor) — and only then offers a
 * correction. Two consequences, both deliberate:
 *
 *   1. The judge cannot rewrite on a whim. A rewrite has to be justified by a
 *      concrete, named error, which is far harder to hallucinate than a vague
 *      "this could be better".
 *   2. The DECISION is not the model's. `shouldFix` (below) applies a fixed
 *      severity threshold in code: minor errors never trigger a rewrite. The
 *      model reports; the pipeline decides. That is what keeps a chatty model
 *      from churning half the corpus into synonyms.
 *
 * The prompt also spells out, as hard constraints, the same rules
 * `validate/qa.ts` enforces on any translation (markup parity, escape/newline
 * counts, no leftover English or Chinese, sane length) — and `judgeFile` re-checks the
 * model's output against that very code, so a rewrite that breaks them is thrown
 * away rather than trusted.
 *
 * The prompt is sent on every request, so its length is a per-unit cost over the
 * whole corpus: keep it terse. Every rule below is load-bearing (each maps to a
 * gate in `validate/qa.ts` or to a JUDGE_VERSION note in `config/judge.ts`) — trim
 * the prose around a rule, never the rule.
 *
 * Replace the whole system prompt via TAIWU_JUDGE_PROMPT_FILE, and bump
 * JUDGE_VERSION when you do (see `config/judge.ts`), or nothing re-judges.
 */
import { readFile } from "node:fs/promises";

import { JUDGE_EXPLANATIONS, JUDGE_PROMPT_FILE } from "../config/judge.js";
import { matchGlossary } from "../glossary/match.js";

/**
 * The built-in judge system prompt. `explanations` toggles the per-error
 * "explanation" field: when off, the prompt never mentions it (and the schema
 * omits it), so the model returns only category + severity.
 */
export function defaultSystemPrompt(explanations: boolean): string {
  return `You annotate, by MQM, the quality of a machine translation into Russian for The Scroll of Taiwu (太吾绘卷), a Chinese wuxia (武侠) life-simulation game.

Blocks you are given for one string:
- FILE, KEY: where the string lives. The filename gives the register — item/skill/place files are short noun phrases, event/dialogue files prose, UI files terse labels.
- ENGLISH: the text that was translated. Itself machine-translated from Chinese, so it may be awkward or wrong.
- CHINESE: the original, and the MEANING OF RECORD — where English and Chinese disagree, Chinese wins.
- RUSSIAN: the translation you annotate.
- MACHINE: the raw engine output, present only when the RUSSIAN is an earlier judge's rewrite of it. A second opinion, not a target: keep the rewrite if it fixed a real problem; if it drifted from the Chinese, invented a term or reads worse, say so and put the better text (MACHINE's wording or your own) in "ru".
- GLOSSARY: mandatory Russian renderings, when any term occurs.

## Task

List ONLY the real errors in the RUSSIAN, each with a category and a severity. Then, if and only if at least one error is major or critical, write a corrected Russian in "ru". If every error is minor, or there are none, leave "ru" empty.

An empty error list is the correct, expected answer for most strings: most of these machine translations are acceptable. Do not go looking for errors to justify a rewrite.
${explanations ? `\nEach error's "explanation" is ONE short sentence naming the defect (≤ 200 characters) — the conclusion only, not your reasoning, not alternatives you weighed.\n` : ""}
## Severity

- critical: misleads the player about game mechanics, or is unusable (a number, effect or condition contradicts the Chinese; gibberish).
- major: meaning changed or comprehension disrupted — mistranslation, a dropped or invented clause, English or Chinese left in the Russian, a mandated glossary term ignored, a special character the ENGLISH has dropped (the wrapping "quotes" of a quoted line, a [bracketed] keyword marker), grammar broken enough to obscure the sense.
- minor: an error that neither disrupts flow nor hinders comprehension — clumsy but understandable phrasing, an imperfect but acceptable term, a missing comma.

## Categories

accuracy/mistranslation, accuracy/omission, accuracy/addition, accuracy/untranslated, terminology, fluency/grammar, fluency/agreement, fluency/spelling, fluency/punctuation, style/register, markup

## What is NOT an error — never report these

A wording that differs from yours but means the same; a synonym you like less; a different but valid word order; a non-literal rendering that preserves the meaning; a readable, consistent transliteration of a Chinese name; a valid stylistic choice you would not have made. If your only complaint is that you could phrase it more elegantly, there is no error — report nothing.

## Hard constraints on any correction you write

Breaking any of these rejects the correction automatically and wastes your work:
1. MARKUP IS SACRED. Every tag and placeholder in the ENGLISH — {0}, {1}, <color=#ffffff>, </color>, <NL>, <Character .../> — appears in your Russian exactly: same tokens, count, numbers. Never add, drop, reorder or translate markup.
2. ESCAPES ARE SACRED. Backslash escapes (\\n, \\t, \\", \\\\, \\uXXXX): same count, well-formed. Never a bare backslash, never a truncated \\uXXXX.
3. SPECIAL CHARACTERS ARE SACRED. Every " ( ) [ ] { } % # $ * + = the ENGLISH has appears in your Russian the same number of times, in the matching place. If the English wraps the line in "quotes", wrap yours in the same straight " — do NOT swap it for «», for a dash, or drop it. A keyword marked [Protection] stays [Защита], in brackets.
4. Do not add or remove real line breaks.
5. NO LATIN LETTERS in the Russian (unless the source itself is a code or an id).
6. NO CHINESE IN THE RUSSIAN. Not one hanzi (汉字). The CHINESE block is to READ, never to copy: names, terms and titles go in TRANSLITERATED in Cyrillic (六甲镜 → «Зеркало Шестицзя», never «Зеркало 六甲»), never as characters, never as a parenthetical gloss beside the Russian. One Chinese character is an automatic rejection.
7. GLOSSARY IS SACRED. A listed term is FIXED and MANDATORY, over your preference, the wuxia tone and any more natural-sounding alternative: never substitute a synonym, a "better" word or another transliteration, not even one that means the same. Already used (in any case/number/gender)? Correct — do not touch it. Anything else used for that concept? At LEAST terminology/major, and your correction must use the glossary term, declined to fit the grammar. Dropping or replacing one is an automatic rejection.
8. KEEP IT CONCISE. The UI is laid out for English widths; longer Russian is clipped with an ellipsis in-game and text is lost. Aim at or below the English length, never pad, drop nothing meaningful to save space. Over twice the English length is rejected — say it the shorter way.
9. The Russian must not be empty or wildly shorter than the English (do not drop content to shorten).
10. "ru" holds ONLY the translation — no commentary, no English gloss. Quotation marks the ENGLISH itself contains belong to the text and stay (rule 3).

If you cannot correct the text without breaking a constraint, report the errors and leave "ru" empty.

## Examples

ENGLISH: The Wandering Sect values freedom above all.
CHINESE: 游侠派最重自由。
RUSSIAN: Секта странников превыше всего ценит свободу.
→ errors: []  ru: ""   (a faithful, natural rendering — nothing to fix)

ENGLISH: Hexagonal Mirror
CHINESE: 六甲镜
RUSSIAN: Шестигранное зеркало
→ errors: [{accuracy/mistranslation, major${explanations ? `, "六甲 (Six Jia, a cyclical/esoteric term) read as 'hexagonal'; the meaning is lost"` : ""}}]  ru: "Зеркало Шестицзя"

ENGLISH: Restores {0} points of Inner Power.
CHINESE: 恢复{0}点内力。
RUSSIAN: Восстанавливает {0} очков внутренней силы.
→ errors: []  ru: ""   (correct; "очков" vs "единиц" is a synonym choice, not an error)

ENGLISH: Pass the Divine Loong's trial.
CHINESE: 通过神龙的试炼。
RUSSIAN: Пройди испытание Божественного Дракона.
GLOSSARY: divine loong → божественный лун
→ errors: [{terminology, major${explanations ? `, "glossary mandates 'лун'; 'Дракона' substitutes it"` : ""}}]  ru: "Пройди испытание Божественного луна"   ('дракон', 'змей' are wrong however well they read; only 'лун', declined)`;
}

let cachedPrompt: string | null = null;

/** The judge system prompt: the override file when set, else the built-in one. */
export async function loadSystemPrompt(): Promise<string> {
  if (cachedPrompt !== null) return cachedPrompt;
  if (!JUDGE_PROMPT_FILE) {
    cachedPrompt = defaultSystemPrompt(JUDGE_EXPLANATIONS);
    return cachedPrompt;
  }
  const custom = (await readFile(JUDGE_PROMPT_FILE, "utf8")).trim();
  if (!custom) throw new Error(`TAIWU_JUDGE_PROMPT_FILE is empty: ${JUDGE_PROMPT_FILE}`);
  cachedPrompt = custom;
  return cachedPrompt;
}

export interface JudgeContext {
  /** Source file the unit belongs to, e.g. `Skill_language.txt`. */
  file: string;
  /** The unit's key inside that file. */
  key: string;
  en: string;
  cn: string | null;
  ru: string;
  /**
   * The raw engine output for this source, when `ru` is no longer it — i.e. an
   * earlier judge pass rewrote the unit. Omitted (or equal to `ru`, in which case
   * it is not shown) for an untouched machine translation, where it would just
   * repeat the RUSSIAN block.
   */
  machine?: string | null;
}

/** The per-unit user message: file/key context, the texts, the glossary. */
export function buildUserMessage(ctx: JudgeContext, glossary: ReadonlyMap<string, string>): string {
  const matches = matchGlossary(ctx.en, glossary);
  const parts = [
    `FILE: ${ctx.file}`,
    `KEY: ${ctx.key}`,
    `ENGLISH:\n${ctx.en}`,
    ctx.cn === null
      ? "CHINESE: (absent — this string exists only in English)"
      : `CHINESE (meaning of record):\n${ctx.cn}`,
    `RUSSIAN (annotate this):\n${ctx.ru}`,
  ];
  if (ctx.machine != null && ctx.machine !== ctx.ru) {
    parts.push(
      "MACHINE (the raw engine output; the RUSSIAN above is an earlier judge's rewrite of it):\n" +
        ctx.machine,
    );
  }
  if (matches.length > 0) {
    const lines = matches.map((m) => `${m.en} → ${m.ru}`).join("\n");
    // Terse on purpose: constraint 7 of the system prompt already spells out that
    // these are mandatory and what dropping one costs. Repeating it per unit only
    // buys tokens.
    parts.push(`GLOSSARY (MANDATORY, decline to fit the grammar):\n${lines}`);
  }
  return parts.join("\n\n");
}

export const SEVERITIES = ["minor", "major", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

const CATEGORIES = [
  "accuracy/mistranslation",
  "accuracy/omission",
  "accuracy/addition",
  "accuracy/untranslated",
  "terminology",
  "fluency/grammar",
  "fluency/agreement",
  "fluency/spelling",
  "fluency/punctuation",
  "style/register",
  "markup",
] as const;

/**
 * Structured-output schema for the annotation (LM Studio `response_format`).
 * With `explanations` off, the per-error `explanation` field is dropped entirely
 * — the model is grammar-constrained to category + severity, so it cannot pad the
 * output (and cannot dump chain-of-thought, which is what overflowed the context
 * window on long units).
 */
export function verdictSchema(explanations: boolean): {
  name: string;
  schema: Record<string, unknown>;
} {
  const errorProps: Record<string, unknown> = {
    category: { type: "string", enum: [...CATEGORIES] },
    severity: { type: "string", enum: [...SEVERITIES] },
  };
  const required = ["category", "severity"];
  if (explanations) {
    // Capped so the model states the defect, not its whole reasoning.
    errorProps.explanation = { type: "string", maxLength: 240 };
    required.push("explanation");
  }
  return {
    name: "mqm_annotation",
    schema: {
      type: "object",
      properties: {
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: errorProps,
            required,
            additionalProperties: false,
          },
        },
        ru: { type: "string" },
      },
      required: ["errors", "ru"],
      additionalProperties: false,
    },
  };
}

export interface JudgeError {
  category: string;
  severity: Severity;
  explanation: string;
}

export interface Verdict {
  errors: JudgeError[];
  /** The model's proposed correction, or "" when it offered none. */
  ru: string;
}

/**
 * Whether an annotation warrants rewriting the translation: a correction was
 * offered AND at least one error is major or critical. This threshold — not the
 * model's own enthusiasm — is what decides. Minor errors are, by MQM's own
 * definition, errors that do not hinder comprehension: not worth the churn (nor
 * the risk) of touching a shipped translation.
 */
export function shouldFix(verdict: Verdict): boolean {
  if (verdict.ru === "") return false;
  return verdict.errors.some((e) => e.severity === "major" || e.severity === "critical");
}

/**
 * Parse the model's answer. Tolerates a model that ignores the schema and wraps
 * its JSON in prose or a ```json fence; anything unparseable yields an empty
 * annotation (leave the translation alone) rather than risking a bad write.
 */
export function parseVerdict(raw: string): Verdict {
  const json = extractJson(raw);
  if (!json) return { errors: [], ru: "" };
  const errors = Array.isArray(json.errors)
    ? json.errors.filter(isJudgeError).map((e) => ({
        category: e.category,
        severity: e.severity,
        explanation: e.explanation ?? "",
      }))
    : [];
  return { errors, ru: typeof json.ru === "string" ? json.ru.trim() : "" };
}

function isJudgeError(value: unknown): value is JudgeError {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.category === "string" &&
    typeof e.severity === "string" &&
    (SEVERITIES as readonly string[]).includes(e.severity)
  );
}

function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One-line summary of an annotation, for the CLI report. */
export function summarize(verdict: Verdict): string {
  return verdict.errors
    .map((e) =>
      e.explanation
        ? `${e.severity}/${e.category}: ${e.explanation}`
        : `${e.severity}/${e.category}`,
    )
    .join("; ");
}
