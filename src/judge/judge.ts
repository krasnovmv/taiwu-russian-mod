/**
 * LLM-judge pass over one file's translation memory.
 *
 * For every machine-translated unit it asks an LLM (Yandex AI Studio) to review
 * the Russian against the English source, the Chinese original and the glossary,
 * and rewrites the ones it rules wrong. Writes ONLY the TM — never the game files,
 * never the engine cache.
 *
 * What it does NOT touch:
 *   - pending units (no `ru` yet)          → the translator's job
 *   - `reviewed` / `locked` units          → human curation always wins
 *   - `neutral` units (EN == CN: ids/codes)→ nothing to judge
 *   - units whose source drifted           → their `ru` is stale; re-translate first
 *
 * A fix keeps the unit's `engine` (the translator that produced the text it was
 * derived from) and sets `status: "judged"`, which makes a cache-only rebuild leave
 * it alone while a genuine source change still re-translates it from scratch.
 *
 * A fix whose markup does not match the English is rejected and the unit is left
 * untouched AND unmarked, so a later run retries it — corrupt markup is never
 * written (same guarantee as the translation pipeline).
 *
 * Identical review contexts are judged ONCE ({@link keepKey}): the corpus
 * repeats short strings ("Adventure", "Interaction", …) thousands of times, so
 * units with the same EN/CN and engine share one verdict, which fans out to all
 * of them. The CLI passes one {@link JudgeOptions.memo} across every file of a
 * run — the disk-backed `VerdictCache` (`cache/judge.jsonl`), so settled verdicts
 * are also replayed across runs: a re-extracted unit or a new duplicate of an
 * already-judged string costs nothing. Already-marked units are skipped even
 * earlier by their stamped `judgeHash`.
 *
 * What is left after all that dedup is sent in BATCHES ({@link JUDGE_BATCH}):
 * these strings are mostly short, and on a short string the model barely
 * deliberates, so a request per context spends more on the round trip than on the
 * judging. A batch is one request and one conversation turn; the answer carries
 * an entry per unit id, and every gate below it stays strictly per unit — one bad
 * entry never costs the units it travelled with.
 */
import { createHash } from "node:crypto";

import {
  JUDGE_BATCH,
  JUDGE_BATCH_CHARS,
  JUDGE_CHECKPOINT,
  JUDGE_CONCURRENCY,
  JUDGE_EXPLANATIONS,
  JUDGE_SESSION_TURNS,
  JUDGE_VERSION,
} from "../config/judge.js";
import { EngineCache } from "../engine/cache-lookup.js";
import { mapPool, type ChatClient } from "../engine/chat-client.js";
import { loadGlossary } from "../glossary/load.js";
import { matchGlossary } from "../glossary/match.js";
import type { TmFile, TmUnit } from "../model/tm.js";
import { makeSrcHasher } from "../tm/hash.js";
import { loadTm, saveTm } from "../tm/store.js";
import { checkTranslation, glossaryMisses } from "../validate/qa.js";
import {
  batchVerdictSchema,
  buildBatchMessage,
  loadSystemPrompt,
  parseBatchVerdict,
  shouldFix,
  summarize,
  type JudgeContext,
} from "./prompt.js";
import { ChatSession, MAX_HISTORY_CHARS } from "./session.js";

/** Engine marker the pipeline gives language-neutral units (EN == CN). */
const NEUTRAL_ENGINE = "neutral";

/**
 * Fingerprint of the context a verdict was made on. `srcHash` already folds in the
 * EN source and the applicable glossary terms, so this adds only the CN reference
 * and the judge version — see `config/judge.ts` for what invalidates what.
 */
export function judgeHash(srcHash: string, cn: string | null): string {
  return createHash("sha256")
    .update(`${JUDGE_VERSION} ${srcHash} ${cn ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** A settled verdict for one review context, reusable across files and runs. */
export type JudgeOutcome = { kind: "keep" } | { kind: "fix"; ru: string };

/**
 * Where settled verdicts live: a plain `Map` (dry runs, tests) or the disk-backed
 * `VerdictCache` (`cache/judge.jsonl`), which also persists them across runs.
 * `flush`, when present, is called at every checkpoint — BEFORE the TM flush, so
 * an interruption between the two can only leave a verdict that is cached but
 * not yet applied (replayed for free next run), never the reverse.
 */
export interface JudgeMemo {
  get(key: string): JudgeOutcome | undefined;
  set(key: string, outcome: JudgeOutcome): void;
  flush?(): Promise<void>;
}

export interface JudgeOptions {
  /** Judge at most this many units (sampling). */
  limit?: number;
  /** Only judge units with `minLen <= en.length <= maxLen`. */
  minLen?: number;
  maxLen?: number;
  /** Re-judge units that already carry a current verdict. */
  force?: boolean;
  /** Compute verdicts but never write the TM. */
  dryRun?: boolean;
  now?: string;
  concurrency?: number;
  /**
   * Units reviewed inside one conversation before it restarts (see
   * `judge/session.ts`); 1 makes every request stateless. Defaults to
   * {@link JUDGE_SESSION_TURNS}.
   */
  sessionTurns?: number;
  /**
   * Review contexts packed into one request; defaults to {@link JUDGE_BATCH}.
   * 1 sends a request per context, the shape the judge had before batching.
   */
  batch?: number;
  /** Character budget for one request; defaults to {@link JUDGE_BATCH_CHARS}. */
  batchChars?: number;
  /**
   * Verdict memo: {@link fixKey}/{@link keepKey} → settled outcome. Pass ONE memo to every
   * call of a run and a context already judged in an earlier file is settled
   * without a request; pass the disk-backed VerdictCache and the reuse extends
   * across runs. Rejected fixes and model errors are deliberately never
   * memoized — they stay retryable. `--force` bypasses reads (fresh verdicts)
   * but still records the outcomes.
   */
  memo?: JudgeMemo;
  onStart?: (totalUnits: number) => void;
  onProgress?: (done: number) => void;
}

export interface JudgeStats {
  file: string;
  /** Requests the run sent to the model (each carries a batch of contexts). */
  requests: number;
  /** Review contexts the model returned a verdict on (one per group). */
  judged: number;
  /** Requests ruled fine: no error, or none serious enough to rewrite. */
  ok: number;
  /** Of those: annotated with minor errors only — deliberately not rewritten. */
  minorOnly: number;
  /** Requests that produced a rewrite (major/critical error, passed QA). */
  fixed: number;
  /** Rewrite offered but rejected by QA (markup/escape/newline/length) — NOT written. */
  rejected: number;
  /** Units settled WITHOUT a request: duplicates of a judged context (this file or the memo). */
  reused: number;
  /**
   * Groups left unanswered — the request threw, the batch was unreadable, or the
   * model skipped the unit. Every member stays unmarked so a later run retries.
   */
  errors: number;
  fixes: { key: string; note: string; before: string; after: string }[];
  problems: JudgeProblem[];
}

/**
 * One unit a run could not settle, carrying enough context to triage it without
 * going back to the TM — which is what the dumped report is for.
 *
 *   request      the call itself threw; the whole batch went with it
 *   unparseable  the answer could not be read even after splitting to this unit
 *   missing      the batch answer simply had no entry for this unit
 *   rejected     a rewrite was offered and the QA gates threw it away
 *
 * The first three leave the unit unmarked, so a later run retries it; the fourth
 * does too, and is the one that says something about the judge rather than the
 * transport.
 */
export interface JudgeProblem {
  key: string;
  kind: "request" | "unparseable" | "missing" | "rejected";
  detail: string;
  en: string;
  ru: string;
  /** The rewrite QA threw away — `rejected` only. */
  fix?: string;
  /** The errors the judge annotated to justify that rewrite — `rejected` only. */
  note?: string;
}

interface Candidate {
  key: string;
  unit: TmUnit;
  hash: string;
}

/** Duplicates of one review context: one verdict, fanned out to every member. */
type Group = Candidate[];

/**
 * Pack `items` into batches bounded BOTH by count and by a cost budget, keeping
 * the input order. An item costing more than the whole budget travels alone
 * rather than being dropped — the judge must never silently skip a unit.
 *
 * Shared shape with `batchByChars` in `engine/yandex.ts`, kept separate because
 * that one batches strings for the MT API and this one batches groups of TM
 * candidates; folding them together would only buy a generic with two callers.
 */
export function batchByCost<T>(
  items: T[],
  maxItems: number,
  budget: number,
  cost: (item: T) => number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let spent = 0;
  for (const item of items) {
    const c = cost(item);
    if (current.length > 0 && (current.length >= maxItems || spent + c > budget)) {
      batches.push(current);
      current = [];
      spent = 0;
    }
    current.push(item);
    spent += c;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * The two kinds of verdict are remembered under DIFFERENT keys, because they are
 * statements about different things.
 *
 * A FIX says "for this source, the right Russian is X". That holds for every
 * duplicate whatever each currently carries, so {@link fixKey} identifies the
 * review context alone: the unit's {@link judgeHash} — which folds JUDGE_VERSION,
 * the EN source, the applicable glossary terms and the CN reference — plus the
 * engine whose translation was reviewed.
 *
 * A KEEP says "THIS Russian is acceptable", which is a claim about the wording in
 * front of the model, so {@link keepKey} adds that wording. The RU used to be left
 * out of the key on the reasoning that duplicates virtually always carry the same
 * text anyway. They do not always: 466 groups across the corpus disagree, and the
 * misaligned encyclopedia tables made a population of them. When they disagree,
 * the old key let one member's "keep" settle the whole group — freezing 604 units
 * as reviewed-and-fine on wording no model had ever been shown. `r1477c6` sat at
 * "Отправка древнего котла:" for "Interaction Effects:" that way, while the judge,
 * asked about it directly, corrected it three times out of three.
 *
 * Splitting the keys is also what lets the old cache survive the change: fixes
 * keep their key and stay valid, while the keeps recorded under it are simply
 * never matched again and get re-earned.
 *
 * `hash` is the unit's CURRENT srcHash (selection guarantees it), so anything
 * that would invalidate a verdict — source, glossary, CN, JUDGE_VERSION —
 * changes both keys and a stale cached verdict is never hit again.
 */
export function fixKey(hash: string, unit: TmUnit): string {
  return `${judgeHash(hash, unit.cn)} ${unit.engine ?? ""}`;
}

/** @see fixKey — the same context, plus the exact Russian the verdict was made on. */
export function keepKey(hash: string, unit: TmUnit): string {
  const ru = createHash("sha256")
    .update(unit.ru ?? "")
    .digest("hex")
    .slice(0, 16);
  return `${fixKey(hash, unit)} ${ru}`;
}

/**
 * Where one unit stands with respect to the judge. The rules live here and
 * nowhere else, so the selection a run makes ({@link selectJudgeWork}) and the
 * coverage a report shows ({@link judgeCoverage}) can never drift apart.
 *
 *   pending  no `ru` yet                    → the translator's job
 *   human    reviewed/locked                → human curation always wins
 *   neutral  EN == CN (ids, codes)          → nothing to judge
 *   drifted  stored srcHash is stale        → re-translate before judging
 *   judged   carries a current verdict      → skipped unless --force
 *   todo     translated and unjudged        → what a run would send
 */
export type JudgeState = "pending" | "human" | "neutral" | "drifted" | "judged" | "todo";

/**
 * Classify a unit, and hand back the CURRENT source hash when one was needed to
 * decide (empty for the states settled before it is computed — hashing every
 * pending unit would be wasted work on a corpus this size).
 */
export function judgeState(
  unit: TmUnit,
  hashEn: (en: string) => string,
): { state: JudgeState; hash: string } {
  if (unit.ru === null) return { state: "pending", hash: "" };
  if (unit.status === "reviewed" || unit.status === "locked") return { state: "human", hash: "" };
  if (unit.engine === NEUTRAL_ENGINE) return { state: "neutral", hash: "" };
  const hash = hashEn(unit.en);
  if (unit.srcHash !== hash) return { state: "drifted", hash };
  const state = unit.judgeHash === judgeHash(hash, unit.cn) ? "judged" : "todo";
  return { state, hash };
}

/**
 * The units a judge run would send to the model, in TM order. Pure, so the CLI
 * can size a global progress bar with exactly the work the run will do.
 */
export function selectJudgeWork(
  tm: TmFile,
  hashEn: (en: string) => string,
  options: Pick<JudgeOptions, "limit" | "minLen" | "maxLen" | "force"> = {},
): Candidate[] {
  const minLen = options.minLen ?? 0;
  const maxLen = options.maxLen ?? Infinity;
  const out: Candidate[] = [];

  for (const [key, unit] of Object.entries(tm.units)) {
    if (options.limit !== undefined && out.length >= options.limit) break;
    if (unit.en.length < minLen || unit.en.length > maxLen) continue;

    const { state, hash } = judgeState(unit, hashEn);
    if (state === "todo" || (state === "judged" && options.force)) out.push({ key, unit, hash });
  }
  return out;
}

/** How much of one TM the judge has been through. Counts units, not requests. */
export interface JudgeCoverage {
  file: string;
  /** Carries a verdict that still stands. */
  judged: number;
  /** Translated, in scope, no current verdict — what `--all` would pick up. */
  todo: number;
  /** Out of the judge's reach: pending, human-curated, neutral or drifted. */
  outOfScope: number;
}

/** Judge coverage for one loaded TM (read-only; no requests). */
export function judgeCoverage(tm: TmFile, hashEn: (en: string) => string): JudgeCoverage {
  const out: JudgeCoverage = { file: tm.file, judged: 0, todo: 0, outOfScope: 0 };
  for (const unit of Object.values(tm.units)) {
    const { state } = judgeState(unit, hashEn);
    if (state === "judged") out.judged++;
    else if (state === "todo") out.todo++;
    else out.outOfScope++;
  }
  return out;
}

/**
 * The order a run works its files in, given what {@link planJudgeFile} counted
 * for each. Ties break by name, so a run is reproducible.
 *
 * Smallest first by default: whole files finish (and land in the TM) early, so an
 * interrupted run leaves the most files fully judged.
 *
 * `largestFirst` trades exactly that away, and buys full batches. A file holding
 * one unit is one request carrying one context however high {@link JUDGE_BATCH}
 * is set, so a queue that opens with hundreds of them spends the run on round
 * trips. Leading with the big files keeps requests full for as long as possible
 * and leaves the unavoidable one-unit requests for the tail.
 */
export function orderJudgeFiles(
  files: string[],
  planned: ReadonlyMap<string, number>,
  largestFirst = false,
): string[] {
  const direction = largestFirst ? -1 : 1;
  return [...files].sort(
    (a, b) => direction * ((planned.get(a) ?? 0) - (planned.get(b) ?? 0)) || a.localeCompare(b),
  );
}

/** Count the units a judge run would send to the model for `file` (no requests). */
export async function planJudgeFile(
  file: string,
  options: Pick<JudgeOptions, "limit" | "minLen" | "maxLen" | "force"> = {},
): Promise<number> {
  const tm = await loadTm(file);
  if (!tm) return 0;
  const hashEn = makeSrcHasher(await loadGlossary());
  return selectJudgeWork(tm, hashEn, options).length;
}

export async function judgeFile(
  file: string,
  client: ChatClient,
  options: JudgeOptions = {},
): Promise<JudgeStats> {
  const tm = await loadTm(file);
  if (!tm) {
    options.onStart?.(0);
    return emptyStats(file);
  }
  const stats = await judgeTm(tm, client, await loadGlossary(), {
    ...options,
    flush: options.dryRun ? undefined : saveTm,
  });
  stats.file = file; // report under the source id, not the TM key
  return stats;
}

function emptyStats(file: string): JudgeStats {
  return {
    file,
    requests: 0,
    judged: 0,
    ok: 0,
    minorOnly: 0,
    fixed: 0,
    rejected: 0,
    reused: 0,
    errors: 0,
    fixes: [],
    problems: [],
  };
}

/**
 * Judge one loaded TM in place. Split from {@link judgeFile} so the dedup,
 * batching and fan-out logic can be exercised on an in-memory TM with a scripted
 * client; `flush` (when given) persists the TM after every checkpoint.
 */
export async function judgeTm(
  tm: TmFile,
  client: ChatClient,
  glossary: ReadonlyMap<string, string>,
  options: JudgeOptions & { flush?: (tm: TmFile) => Promise<void> } = {},
): Promise<JudgeStats> {
  const hashEn = makeSrcHasher(glossary);
  const work = selectJudgeWork(tm, hashEn, options);
  options.onStart?.(work.length);
  if (work.length === 0) return emptyStats(tm.file);

  // One verdict per distinct review context AND wording, fanned out to the whole
  // group. Grouped by {@link keepKey}, not by the context alone: members that
  // disagree on the Russian are different questions, and lumping them together is
  // how one member's "keep" used to settle wording the model never saw.
  // Progress ticks per UNIT (the plan counted units, not groups or requests).
  const groups = new Map<string, Group>();
  for (const item of work) {
    const k = keepKey(item.hash, item.unit);
    const g = groups.get(k);
    if (g) g.push(item);
    else groups.set(k, [item]);
  }

  // A unit an earlier pass already rewrote no longer holds the engine's wording.
  // Load that engine's cache so the judge can be shown BOTH — otherwise a second
  // pass (a better model, a bumped JUDGE_VERSION) would review the previous
  // judge's output as if it were the machine's, and rewrites would compound.
  // Memoize the PROMISE, not the result: judging runs concurrently, and two units
  // hitting the same engine must not both load (and parse) the cache file.
  const caches = new Map<string, Promise<EngineCache | null>>();
  const machineFor = async (unit: TmUnit): Promise<string | null> => {
    if (unit.status !== "judged" || unit.engine === null) return null;
    let cache = caches.get(unit.engine);
    if (!cache) {
      cache = EngineCache.forEngine(unit.engine);
      caches.set(unit.engine, cache);
    }
    return (await cache)?.lookup(unit.en) ?? null;
  };

  // The unit's own file id is part of the prompt: the judge is told where the
  // string lives, which is what tells it the register to expect.
  const system = await loadSystemPrompt();
  const schema = batchVerdictSchema(JUDGE_EXPLANATIONS);
  const stats: JudgeStats = emptyStats(tm.file);
  const concurrency = Math.max(1, options.concurrency ?? JUDGE_CONCURRENCY);
  const batchSize = Math.max(1, options.batch ?? JUDGE_BATCH);
  const batchChars = Math.max(1, options.batchChars ?? JUDGE_BATCH_CHARS);
  // One conversation per concurrent lane, kept across checkpoints so a window is
  // not cut short every checkpoint. They do NOT outlive the file: `judgeTm` is
  // called per TM, so a file with fewer batches than the window simply never
  // fills one — worth folding into a global work queue if the many tiny files
  // ever justify it. A turn is a whole batch, so the history cap has to be sized
  // to batches or it would close a conversation after two of them.
  const sessionTurns = Math.max(1, options.sessionTurns ?? JUDGE_SESSION_TURNS);
  const sessions = Array.from(
    { length: concurrency },
    () =>
      new ChatSession(client, system, sessionTurns, Math.max(MAX_HISTORY_CHARS, 3 * batchChars)),
  );

  let done = 0;
  const tick = (units: number): void => {
    done += units;
    options.onProgress?.(done);
  };
  const units = (batch: Group[]): number => batch.reduce((n, g) => n + g.length, 0);

  const keepAll = (members: Group): void => {
    for (const m of members)
      tm.units[m.key] = { ...m.unit, judgeHash: judgeHash(m.hash, m.unit.cn) };
  };
  const fixAll = (members: Group, fixedRu: string): void => {
    for (const m of members)
      tm.units[m.key] = {
        ...m.unit,
        ru: fixedRu,
        status: "judged",
        judgeHash: judgeHash(m.hash, m.unit.cn),
        updatedAt: options.now ?? m.unit.updatedAt,
      };
  };

  /**
   * A verdict an earlier file — or, with the disk-backed memo, an earlier run —
   * already settled for this group, or `undefined` to go and ask.
   *
   * The group's own wording is asked about first: a `keep` recorded for exactly
   * this Russian settles it. Failing that, a `fix` recorded for the context says
   * what the Russian SHOULD be, which is true of any duplicate whatever it
   * currently holds, so it applies here too — it was QA-gated when memoized, and
   * both QA and the glossary derive from the EN alone.
   *
   * A `keep` found under the context key is deliberately ignored: those are lines
   * written before keeps were keyed by wording, and reusing them is precisely the
   * bug — the wording they were made on is unknown and may not be this one.
   */
  const settledFor = (head: Candidate): JudgeOutcome | undefined => {
    if (options.force) return undefined; // --force wants fresh verdicts
    const kept = options.memo?.get(keepKey(head.hash, head.unit));
    if (kept?.kind === "keep") return kept;
    const fixed = options.memo?.get(fixKey(head.hash, head.unit));
    return fixed?.kind === "fix" ? fixed : undefined;
  };

  // Settled BEFORE the batches are packed, so a request is never half-full of
  // work already done. Nothing is lost by resolving them up front: the keep key
  // IS the group key, so two groups of one file can never share one, and no
  // intra-file hit could appear part-way through the run.
  const pending: Group[] = [];
  for (const members of groups.values()) {
    const settled = settledFor(members[0] as Candidate);
    if (!settled) {
      pending.push(members);
      continue;
    }
    if (settled.kind === "keep") keepAll(members);
    else fixAll(members, settled.ru);
    stats.reused += members.length;
    tick(members.length);
  }

  /**
   * Judge one batch in one request, then scatter the answer back by unit id.
   *
   * An answer that could not be read AT ALL splits the batch and retries the
   * halves — without that, the group that broke it would poison every unit
   * travelling with it, and the next run would pack the very same batch by the
   * very same rule and fail identically. Splitting isolates the culprit in
   * ~2·log2(N) extra requests and lands the rest.
   *
   * Every other defect is per unit: a group missing from the answer is left
   * unmarked and un-memoized (a later run retries it) while its neighbours apply
   * normally. A thrown request is NOT split — the clients already retried it, so
   * it is a dead backend or a permanent error, and splitting would only hammer it.
   */
  const judgeBatch = async (batch: Group[], session: ChatSession): Promise<void> => {
    let raw: string;
    const contexts: JudgeContext[] = await Promise.all(
      batch.map(async (members): Promise<JudgeContext> => {
        const { key, unit } = members[0] as Candidate;
        return {
          file: tm.file,
          key,
          en: unit.en,
          cn: unit.cn,
          ru: unit.ru as string,
          machine: await machineFor(unit),
        };
      }),
    );
    try {
      stats.requests++;
      raw = await session.ask(buildBatchMessage(contexts, glossary), { jsonSchema: schema });
    } catch (err) {
      for (const [index, members] of batch.entries()) {
        const { key, unit } = members[0] as Candidate;
        stats.errors++;
        stats.problems.push({
          key,
          kind: "request",
          detail: (err as Error).message,
          en: unit.en,
          ru: contexts[index]?.ru ?? "",
        });
      }
      tick(units(batch));
      return;
    }

    const verdicts = parseBatchVerdict(raw);
    if (verdicts === null) {
      // Garbage is dropped from the conversation too — an unreadable answer left
      // in the history is an example of what the model should NOT return.
      session.rollback();
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await judgeBatch(batch.slice(0, mid), session);
        await judgeBatch(batch.slice(mid), session);
        return;
      }
      const lone = (batch[0] as Group)[0] as Candidate;
      stats.errors++;
      stats.problems.push({
        key: lone.key,
        kind: "unparseable",
        detail: "unparseable model output — will retry",
        en: lone.unit.en,
        ru: lone.unit.ru ?? "",
      });
      tick(units(batch));
      return;
    }

    // A turn is kept only if SOMETHING in it was usable. With one unit per batch
    // that is exactly the old rule (an unusable answer never stays in the
    // history); with forty it stops one rejected rewrite from throwing away
    // thirty-nine good worked examples.
    let usable = 0;
    for (const [index, members] of batch.entries()) {
      const head = members[0] as Candidate;
      const { key, unit } = head;
      const ru = unit.ru as string;
      const verdict = verdicts.get(index + 1);
      if (verdict === undefined) {
        stats.errors++;
        stats.problems.push({
          key,
          kind: "missing",
          detail: "unit missing from the batch answer — will retry",
          en: unit.en,
          ru,
        });
        tick(members.length);
        continue;
      }
      stats.judged++;
      stats.minorOnly += verdict.errors.length > 0 && !shouldFix(verdict) ? 1 : 0;

      // The severity threshold decides, not the model: a rewrite happens only
      // when it is backed by a major/critical error. Everything else is left
      // exactly as it is — and marked, so the next run skips it. Status stays
      // `machine`, so an edited cache entry can still flow into it.
      if (!shouldFix(verdict) || verdict.ru === ru) {
        stats.ok++;
        stats.reused += members.length - 1;
        keepAll(members);
        // Remembered against THIS wording: it is what the model was shown, and
        // all a keep ever claims.
        options.memo?.set(keepKey(head.hash, unit), { kind: "keep" });
        usable++;
        tick(members.length);
        continue;
      }

      // A rewrite must pass exactly the checks `npm run validate` runs (markup
      // parity, escape/newline counts, non-empty, no Latin or hanzi left in the Russian,
      // sane length), PLUS glossary compliance — the judge is given the mandated
      // terms, so a rewrite that ignores one is a regression, not an improvement.
      // If any check fails, drop the rewrite and leave every member UNMARKED
      // (and un-memoized) so a later run retries — the judge must never write
      // what QA would then flag.
      const broken = [
        ...checkTranslation(unit.en, verdict.ru),
        ...glossaryMisses(verdict.ru, matchGlossary(unit.en, glossary)),
      ];
      if (broken.length > 0) {
        stats.rejected++;
        stats.problems.push({
          key,
          kind: "rejected",
          detail: broken.map((i) => `${i.kind}: ${i.detail}`).join("; "),
          en: unit.en,
          ru,
          fix: verdict.ru,
          note: summarize(verdict),
        });
        tick(members.length);
        continue;
      }

      stats.fixed++;
      stats.reused += members.length - 1;
      stats.fixes.push({ key, note: summarize(verdict), before: ru, after: verdict.ru });
      fixAll(members, verdict.ru);
      // Remembered against the CONTEXT: "the right Russian here is X" holds for
      // every duplicate, whatever wording each of them currently carries.
      options.memo?.set(fixKey(head.hash, unit), { kind: "fix", ru: verdict.ru });
      usable++;
      tick(members.length);
    }
    if (usable === 0) session.rollback();
  };

  // Cost a group by the three texts the prompt always carries for it; only the
  // group's head is ever shown, so duplicates ride along free.
  const batches = batchByCost(pending, batchSize, batchChars, (members) => {
    const { unit } = members[0] as Candidate;
    return unit.en.length + (unit.cn?.length ?? 0) + (unit.ru?.length ?? 0);
  });

  // The checkpoint is a group count, but a batch can hold more groups than that,
  // so it becomes a batch count — and never fewer batches than there are lanes,
  // or the pool would be handed one item and the concurrency would be lost.
  const perCheckpoint = Math.max(concurrency, Math.ceil(JUDGE_CHECKPOINT / batchSize));
  for (let start = 0; start < batches.length; start += perCheckpoint) {
    const chunk = batches.slice(start, start + perCheckpoint);

    // Each lane owns its conversation, so turns of concurrent lanes never
    // interleave into one history.
    await mapPool(chunk, concurrency, (batch, _index, lane) =>
      judgeBatch(batch, sessions[lane] as ChatSession),
    );

    // Verdicts first, TM second: interrupted in between, a verdict can be
    // cached-but-unapplied (replayed for free next run) — never applied-but-lost.
    await options.memo?.flush?.();
    if (options.flush) await options.flush(tm);
  }

  return stats;
}
