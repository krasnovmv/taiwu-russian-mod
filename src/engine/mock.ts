import type { TranslationEngine } from "./types.js";

/**
 * Deterministic, offline engine for tests and dry runs. It prefixes each text
 * with `ru:` so output is visibly "translated" while leaving any embedded
 * sentinels intact — exercising the protect/restore path without an API call.
 */
export class MockEngine implements TranslationEngine {
  readonly id = "mock";

  translate(texts: string[]): Promise<string[]> {
    return Promise.resolve(texts.map((t) => `ru:${t}`));
  }
}
