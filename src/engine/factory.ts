import { MockEngine } from "./mock.js";
import type { TranslationEngine } from "./types.js";
import { YandexEngine } from "./yandex.js";

export type EngineId = "mock" | "yandex";

/**
 * Construct an engine by id. The Yandex engine requires credentials in the
 * environment (see {@link YandexEngine.fromEnv}); a clear error is thrown if
 * they are missing so a run never silently falls back.
 */
export function createEngine(id: EngineId): TranslationEngine {
  switch (id) {
    case "mock":
      return new MockEngine();
    case "yandex": {
      const engine = YandexEngine.fromEnv();
      if (!engine) {
        throw new Error(
          "Yandex engine needs TAIWU_YANDEX_IAM_TOKEN and TAIWU_YANDEX_FOLDER_ID in the environment.",
        );
      }
      return engine;
    }
  }
}
