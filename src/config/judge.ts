/**
 * LLM-judge configuration (`npm run judge`).
 *
 * The judge re-reads every machine translation with a local LLM (LM Studio),
 * given the file it lives in, the English source, the Chinese original and the
 * applicable glossary — and rewrites it when it is wrong. It never translates
 * from scratch: pending units are the translator's job (`npm run translate-all`).
 *
 * A verdict is remembered on the unit as `judgeHash` = hash of
 * ({@link JUDGE_VERSION}, the unit's `srcHash`, its CN reference). So a unit is
 * re-judged exactly when something the verdict depended on moved:
 *   - the EN source changed          → new srcHash → re-judge
 *   - the glossary term(s) changed   → new srcHash → re-judge
 *   - the CN reference changed       → new judgeHash → re-judge
 *   - {@link JUDGE_VERSION} bumped   → everything re-judged (the prompt lever)
 * Otherwise the unit is skipped, so re-running the judge is cheap and resumable.
 *
 * Bump {@link JUDGE_VERSION} whenever you change the judge prompt in a way that
 * should invalidate past verdicts — it is the only global re-judge switch.
 */
// 2: MQM annotation prompt — the model reports errors with a severity, and only
//    a major/critical one triggers a rewrite (see judge/prompt.ts `shouldFix`).
//    Version 1's free-form "ok/fix" verdicts rewrote far too eagerly; they are
//    invalidated wholesale.
// 3: a re-judged unit is now also shown the raw engine output it was rewritten
//    from (the MACHINE block), so rewrites can be reverted instead of compounding.
// 4: glossary hardened to non-negotiable in the prompt (dedicated section, hard
//    constraint, worked example) to match the glossary-miss rejection gate.
// 5: special characters (quotes, brackets, %) made sacred in the prompt to match
//    the new special-char-loss gate; the "no quotes" rule reworded so it no longer
//    tells the model to strip a quoted line's own quotation marks.
// 6: conciseness rule — a rewrite more than 2× the English length is rejected
//    (length-bloat gate), since the UI clips overlong Russian with an ellipsis.
const DEFAULT_JUDGE_VERSION = 6;
const DEFAULT_CONCURRENCY = 4;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const JUDGE_VERSION = envInt("TAIWU_JUDGE_VERSION", DEFAULT_JUDGE_VERSION);

/** Parallel judge requests to LM Studio. */
export const JUDGE_CONCURRENCY = envInt("TAIWU_JUDGE_CONCURRENCY", DEFAULT_CONCURRENCY);

/** Units judged before the TM is flushed (bounds work lost if interrupted). */
export const JUDGE_CHECKPOINT = envInt("TAIWU_JUDGE_CHECKPOINT", 25);

/**
 * Whether the model must attach a short `explanation` to each annotated error.
 * On by default — the explanations are what the CLI report and the fix log show.
 * Set `TAIWU_JUDGE_EXPLANATIONS=0` to drop the field entirely: the schema no
 * longer asks for it, the prompt stops mentioning it, and the model's output
 * shrinks (helpful on a tight context window — a reasoning model tends to pad
 * this field). Purely cosmetic: the fix decision (severity + rewrite) and every
 * gate are unaffected, so it does not change which units get rewritten and needs
 * no re-judge.
 */
export const JUDGE_EXPLANATIONS = (process.env.TAIWU_JUDGE_EXPLANATIONS ?? "1") !== "0";

/**
 * Path to a file whose contents replace the built-in judge system prompt.
 * Bump {@link JUDGE_VERSION} after editing it — the prompt text is not hashed
 * into the verdict, so nothing re-judges on its own.
 */
export const JUDGE_PROMPT_FILE = process.env.TAIWU_JUDGE_PROMPT_FILE;
