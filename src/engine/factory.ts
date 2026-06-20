import path from "node:path";

import { cacheDir } from "../config/paths.js";
import { CachingEngine } from "./caching.js";
import { LmStudioEngine } from "./lmstudio.js";
import { MockEngine } from "./mock.js";
import type { TranslationEngine } from "./types.js";
import { YandexEngine } from "./yandex.js";

export type EngineId = "mock" | "yandex" | "lmstudio";

const ENGINE_IDS: ReadonlySet<string> = new Set(["mock", "yandex", "lmstudio"]);

/** Parse an engine id from CLI input, defaulting to `mock`. */
export function parseEngineId(value: string | undefined): EngineId {
  return value && ENGINE_IDS.has(value) ? (value as EngineId) : "mock";
}

function cacheFile(id: EngineId): string {
  return path.join(cacheDir, `${id}.jsonl`);
}

/**
 * Construct an engine by id. The Yandex and LM Studio engines are wrapped in a
 * {@link CachingEngine} so identical source strings are translated once and
 * never re-billed/re-run (the cache survives deleting the translation memory).
 * `mock` is free/deterministic and left unwrapped.
 */
export function createEngine(id: EngineId): TranslationEngine {
  switch (id) {
    case "mock":
      return new MockEngine();
    case "lmstudio":
      return new CachingEngine(LmStudioEngine.fromEnv(), cacheFile(id));
    case "yandex":
      // Credentials come from the `yc` CLI, resolved lazily on first use.
      return new CachingEngine(YandexEngine.fromEnv(), cacheFile(id));
  }
}
