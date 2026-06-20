/**
 * Caching decorator for any {@link TranslationEngine}. Keyed by the (masked)
 * source TEXT — not the game key — so identical strings are translated once and
 * survive deleting the translation memory. The cache is an append-only JSONL
 * file (`{"k":<source>,"v":<translation>}` per line), which is incremental,
 * crash-safe (a torn last line is skipped on load) and git-diff friendly.
 *
 * The cache is per engine (Yandex and LM Studio outputs differ) and assumes a
 * single target language (en→ru). For Yandex the key is exact; for LM Studio the
 * CN reference context is intentionally ignored in the key — identical EN text
 * reuses one translation, trading a negligible quality nuance for big savings.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ProgressCallback, TranslationEngine, TranslationRequest } from "./types.js";

interface CacheLine {
  k: string;
  v: string;
}

export class CachingEngine implements TranslationEngine {
  readonly id: string;
  readonly checkpointSize: number;
  private readonly inner: TranslationEngine;
  private readonly file: string;
  private cache: Map<string, string> | null = null;

  constructor(inner: TranslationEngine, cacheFile: string) {
    this.inner = inner;
    this.file = cacheFile;
    this.id = inner.id; // record the real engine in the TM
    this.checkpointSize = inner.checkpointSize;
  }

  private async load(): Promise<Map<string, string>> {
    if (this.cache) return this.cache;
    const map = new Map<string, string>();
    try {
      const raw = await readFile(this.file, "utf8");
      for (const line of raw.split("\n")) {
        if (line === "") continue;
        try {
          const entry = JSON.parse(line) as CacheLine;
          map.set(entry.k, entry.v);
        } catch {
          // Skip a torn/partial line (e.g. interrupted append).
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.cache = map;
    return map;
  }

  async translate(
    requests: TranslationRequest[],
    onProgress?: ProgressCallback,
  ): Promise<string[]> {
    const cache = await this.load();
    const results = new Array<string>(requests.length);
    const missReqs: TranslationRequest[] = [];
    const missIdx: number[] = [];

    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      if (!req) continue;
      const hit = cache.get(req.text);
      if (hit !== undefined) {
        results[i] = hit;
      } else {
        missIdx.push(i);
        missReqs.push(req);
      }
    }

    const hits = requests.length - missReqs.length;
    if (missReqs.length === 0) {
      onProgress?.(requests.length);
      return results;
    }

    const translated = await this.inner.translate(missReqs, (n) => onProgress?.(hits + n));

    const fresh: string[] = [];
    for (let j = 0; j < missReqs.length; j++) {
      const text = missReqs[j]!.text;
      const out = translated[j] ?? "";
      results[missIdx[j]!] = out;
      if (!cache.has(text)) {
        cache.set(text, out);
        fresh.push(JSON.stringify({ k: text, v: out } satisfies CacheLine));
      }
    }
    if (fresh.length > 0) {
      await mkdir(path.dirname(this.file), { recursive: true });
      await appendFile(this.file, `${fresh.join("\n")}\n`, "utf8");
    }
    return results;
  }
}
