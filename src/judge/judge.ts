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
 */
import { createHash } from "node:crypto";

import {
  JUDGE_CHECKPOINT,
  JUDGE_CONCURRENCY,
  JUDGE_EXPLANATIONS,
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
  buildUserMessage,
  loadSystemPrompt,
  parseVerdict,
  shouldFix,
  summarize,
  verdictSchema,
} from "./prompt.js";

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
  onStart?: (totalUnits: number) => void;
  onProgress?: (done: number) => void;
}

export interface JudgeStats {
  file: string;
  /** Units the run sent to the model. */
  judged: number;
  /** Left as they were: no error, or none serious enough to rewrite. */
  ok: number;
  /** Of those: annotated with minor errors only — deliberately not rewritten. */
  minorOnly: number;
  /** Rewritten (a major/critical error, and the rewrite passed QA). */
  fixed: number;
  /** Rewrite offered but rejected by QA (markup/escape/newline/length) — NOT written. */
  rejected: number;
  /** Units the model errored on; left unmarked so a later run retries them. */
  errors: number;
  fixes: { key: string; note: string; before: string; after: string }[];
  problems: { key: string; error: string }[];
}

interface Candidate {
  key: string;
  unit: TmUnit;
  hash: string;
}

/**
 * The units a judge run would send to the model, in TM order. Pure, so the CLI
 * can size a global progress bar with exactly the work the run will do.
 *
 * `hashEn` supplies the CURRENT source hash: a unit whose stored `srcHash` no
 * longer matches has a stale `ru` (the EN or the glossary moved under it) and is
 * skipped — judging text that is about to be re-translated wastes a request.
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
    if (unit.ru === null) continue; // pending: nothing to judge
    if (unit.status === "reviewed" || unit.status === "locked") continue; // human wins
    if (unit.engine === NEUTRAL_ENGINE) continue; // ids/codes: ru == en by construction
    if (unit.en.length < minLen || unit.en.length > maxLen) continue;

    const hash = hashEn(unit.en);
    if (unit.srcHash !== hash) continue; // stale ru — translate before judging
    if (!options.force && unit.judgeHash === judgeHash(hash, unit.cn)) continue; // already judged

    out.push({ key, unit, hash });
  }
  return out;
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
  const empty: JudgeStats = {
    file,
    judged: 0,
    ok: 0,
    minorOnly: 0,
    fixed: 0,
    rejected: 0,
    errors: 0,
    fixes: [],
    problems: [],
  };
  const tm = await loadTm(file);
  if (!tm) {
    options.onStart?.(0);
    return empty;
  }

  const glossary = await loadGlossary();
  const hashEn = makeSrcHasher(glossary);
  const work = selectJudgeWork(tm, hashEn, options);
  options.onStart?.(work.length);
  if (work.length === 0) return empty;

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
  const schema = verdictSchema(JUDGE_EXPLANATIONS);
  const stats: JudgeStats = { ...empty, fixes: [], problems: [] };
  const concurrency = Math.max(1, options.concurrency ?? JUDGE_CONCURRENCY);
  let done = 0;

  for (let start = 0; start < work.length; start += JUDGE_CHECKPOINT) {
    const chunk = work.slice(start, start + JUDGE_CHECKPOINT);

    await mapPool(chunk, concurrency, async (item) => {
      const { key, unit, hash } = item;
      const ru = unit.ru as string;
      try {
        const raw = await client.chat(
          [
            { role: "system", content: system },
            {
              role: "user",
              content: buildUserMessage(
                {
                  file: tm.file,
                  key,
                  en: unit.en,
                  cn: unit.cn,
                  ru,
                  machine: await machineFor(unit),
                },
                glossary,
              ),
            },
          ],
          { jsonSchema: schema },
        );
        const verdict = parseVerdict(raw);
        stats.judged++;
        stats.minorOnly += verdict.errors.length > 0 && !shouldFix(verdict) ? 1 : 0;

        // The severity threshold decides, not the model: a rewrite happens only
        // when it is backed by a major/critical error. Everything else is left
        // exactly as it is — and marked, so the next run skips it. Status stays
        // `machine`, so an edited cache entry can still flow into it.
        if (!shouldFix(verdict) || verdict.ru === ru) {
          stats.ok++;
          tm.units[key] = { ...unit, judgeHash: judgeHash(hash, unit.cn) };
          return;
        }

        // A rewrite must pass exactly the checks `npm run validate` runs (markup
        // parity, escape/newline counts, non-empty, no Latin left in the Russian,
        // sane length), PLUS glossary compliance — the judge is given the mandated
        // terms, so a rewrite that ignores one is a regression, not an improvement.
        // If any check fails, drop the rewrite and leave the unit UNMARKED so a
        // later run retries — the judge must never write what QA would then flag.
        const broken = [
          ...checkTranslation(unit.en, verdict.ru),
          ...glossaryMisses(verdict.ru, matchGlossary(unit.en, glossary)),
        ];
        if (broken.length > 0) {
          stats.rejected++;
          const why = broken.map((i) => `${i.kind}: ${i.detail}`).join("; ");
          stats.problems.push({ key, error: `fix rejected — ${why}` });
          return;
        }

        stats.fixed++;
        stats.fixes.push({ key, note: summarize(verdict), before: ru, after: verdict.ru });
        tm.units[key] = {
          ...unit,
          ru: verdict.ru,
          status: "judged",
          judgeHash: judgeHash(hash, unit.cn),
          updatedAt: options.now ?? unit.updatedAt,
        };
      } catch (err) {
        stats.errors++;
        stats.problems.push({ key, error: (err as Error).message });
      } finally {
        options.onProgress?.(++done);
      }
    });

    if (!options.dryRun) await saveTm(tm);
  }

  return stats;
}
