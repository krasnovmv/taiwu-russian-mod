/**
 * LLM-judge configuration (`npm run judge`).
 *
 * The judge re-reads every machine translation with an LLM (Yandex AI Studio),
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
// 7: no hanzi in the Russian — a rewrite containing even one Chinese character is
//    rejected (chinese-in-russian gate); the prompt now says the CHINESE block is
//    to be read, not copied, and that names are transliterated into Cyrillic.
// 8: transliteration scoped back to proper names. Constraint 6 now says names,
//    terms and titles are TRANSLATED by meaning, and only a proper name (or a
//    coined term with no Russian meaning) is transliterated — never as a way to
//    replace a good meaning-translation. Version 7's wording and its
//    Hexagonal-Mirror example pushed the judge to spell meaningful names out in
//    Cyrillic instead of translating them; those rewrites are re-judged.
// 9: no prompt change — a deliberate re-hash of the whole corpus. A run made
//    with TAIWU_JUDGE_VERSION=2 stamped part of the TM (and 11045 lines of
//    cache/judge.jsonl) with a number that already meant the version-2 prompt;
//    moving the default to an unused number restores the invariant that the
//    version tracks this file's prompt lineage. Every earlier verdict is
//    orphaned once, so the next full run re-judges from scratch.
const DEFAULT_JUDGE_VERSION = 9;
const DEFAULT_CONCURRENCY = 4;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const JUDGE_VERSION = envInt("TAIWU_JUDGE_VERSION", DEFAULT_JUDGE_VERSION);

/**
 * Which backend the judge talks to: Yandex AI Studio (default) or a local LM
 * Studio server. Set `TAIWU_JUDGE_ENGINE=lmstudio` to use the latter; any other
 * value (or unset) is Yandex. The engine only swaps the transport — prompt,
 * schema and QA gates are identical either way, so it does NOT invalidate
 * verdicts (the model is deliberately not part of `judgeHash`).
 */
export type JudgeEngine = "yandex" | "lmstudio";
export const JUDGE_ENGINE: JudgeEngine =
  (process.env.TAIWU_JUDGE_ENGINE ?? "").trim().toLowerCase() === "lmstudio"
    ? "lmstudio"
    : "yandex";

/** Parallel judge requests to Yandex AI Studio. */
export const JUDGE_CONCURRENCY = envInt("TAIWU_JUDGE_CONCURRENCY", DEFAULT_CONCURRENCY);

/** Units judged before the TM is flushed (bounds work lost if interrupted). */
export const JUDGE_CHECKPOINT = envInt("TAIWU_JUDGE_CHECKPOINT", 25);

/**
 * Turns per conversation: how many units a judge lane reviews inside ONE growing
 * chat before starting a fresh one (see `judge/session.ts`). Each concurrent lane
 * keeps its own conversation, so `TAIWU_JUDGE_CONCURRENCY` conversations are open
 * at a time.
 *
 * DEFAULT 1 = stateless, i.e. exactly the behaviour before sessions existed, and
 * that default is measured, not conservative-by-habit: with one unit per turn a
 * session runs 20-25% SLOWER than stateless requests, because a short unit barely
 * makes the model deliberate, so there is no warm-up to save (it does take the
 * prompt-cache hit rate from 0 to ~57%, but that is a cost metric, not latency).
 * The same A/B on BATCHED turns went the other way, +41%. So this becomes worth
 * raising once the judge sends batches — until then it is a lever to experiment
 * with (`--session-turns N`), not a default to flip.
 *
 * It does NOT invalidate verdicts: like the backend swap, it changes how the
 * model is asked, not what the prompt says, and the model is deliberately not
 * part of `judgeHash`.
 */
export const JUDGE_SESSION_TURNS = envInt("TAIWU_JUDGE_SESSION_TURNS", 1);

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
