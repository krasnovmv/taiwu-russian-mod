/**
 * Disk-backed judge verdict cache (`cache/judge.jsonl`), so a verdict outlives
 * the run that paid for it: when a later run meets the same review context —
 * a re-extracted unit, a new file repeating an already-judged string — the
 * outcome is replayed for free instead of re-asking the model.
 *
 * Keys are {@link verdictKey}: the unit's `judgeHash` (which folds JUDGE_VERSION,
 * the EN source, the applicable glossary terms and the CN reference) plus the
 * engine whose translation was reviewed. Anything that would invalidate a verdict
 * changes the key, so stale entries are never hit again — and bumping
 * JUDGE_VERSION remains the wholesale nuke, orphaning every stored verdict at
 * once. To retract a single bad verdict, delete its line from the file.
 *
 * Line format: `{"k":"<judgeHash> <engine>","v":"<corrected ru>"}`, with `v: ""`
 * meaning "keep" (QA rejects an empty rewrite, so a fix's text is never empty).
 * Same append-only JSONL discipline as the engine caches: incremental,
 * crash-safe (torn last line skipped on load, via {@link readCacheFile}),
 * git-diff friendly, self-compacting when appends left stale duplicate lines.
 */
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { cacheDir } from "../config/paths.js";
import { readCacheFile } from "../engine/caching.js";
import type { JudgeOutcome } from "./judge.js";

export const JUDGE_CACHE_FILE = path.join(cacheDir, "judge.jsonl");

export class VerdictCache {
  private pending: string[] = [];

  private constructor(
    private readonly file: string,
    private readonly entries: Map<string, string>,
  ) {}

  static async open(file: string = JUDGE_CACHE_FILE): Promise<VerdictCache> {
    const { entries, lines } = await readCacheFile(file);
    const cache = new VerdictCache(file, entries);
    if (lines > entries.size) await cache.rewrite();
    return cache;
  }

  get(key: string): JudgeOutcome | undefined {
    const v = this.entries.get(key);
    if (v === undefined) return undefined;
    return v === "" ? { kind: "keep" } : { kind: "fix", ru: v };
  }

  set(key: string, outcome: JudgeOutcome): void {
    const v = outcome.kind === "keep" ? "" : outcome.ru;
    if (this.entries.get(key) === v) return; // already recorded: no churn
    this.entries.set(key, v);
    this.pending.push(JSON.stringify({ k: key, v }));
  }

  /** Append the outcomes recorded since the last flush (checkpoint-sized increments). */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const body = this.pending.join("\n");
    this.pending = [];
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${body}\n`, "utf8");
  }

  /** Atomically overwrite the file with one line per key (temp-file + rename). */
  private async rewrite(): Promise<void> {
    const body = [...this.entries].map(([k, v]) => JSON.stringify({ k, v })).join("\n");
    const tmp = `${this.file}.tmp`;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(tmp, body ? `${body}\n` : "", "utf8");
    await rename(tmp, this.file);
  }
}
