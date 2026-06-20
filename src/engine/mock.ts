import type { TranslationEngine, TranslationRequest } from "./types.js";

/**
 * Deterministic, offline engine for tests and dry runs. It prefixes each text
 * with `ru:` so output is visibly "translated" while leaving any embedded
 * sentinels intact — exercising the protect/restore path without an API call.
 */
export class MockEngine implements TranslationEngine {
  readonly id = "mock";

  translate(requests: TranslationRequest[]): Promise<string[]> {
    return Promise.resolve(requests.map((r) => `ru:${r.text}`));
  }
}
