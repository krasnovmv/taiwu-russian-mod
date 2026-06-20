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

/**
 * Construct an engine by id. The Yandex engine requires credentials in the
 * environment; a clear error is thrown if they are missing so a run never
 * silently falls back. LM Studio points at a local server (no credentials).
 */
export function createEngine(id: EngineId): TranslationEngine {
  switch (id) {
    case "mock":
      return new MockEngine();
    case "lmstudio":
      return LmStudioEngine.fromEnv();
    case "yandex":
      // Credentials come from env or the `yc` CLI, resolved lazily on first use.
      return YandexEngine.fromEnv();
  }
}
