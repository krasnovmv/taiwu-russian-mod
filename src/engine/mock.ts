import type { ProgressCallback, TranslationEngine, TranslationRequest } from "./types.js";

/**
 * Deterministic, offline engine for tests and dry runs. It prefixes each text
 * with `ru:` so output is visibly "translated" while leaving any embedded
 * sentinels intact — exercising the protect/restore path without an API call.
 */
export class MockEngine implements TranslationEngine {
  readonly id = "mock";
  readonly checkpointSize = 200;

  translate(requests: TranslationRequest[], onProgress?: ProgressCallback): Promise<string[]> {
    return Promise.resolve(
      requests.map((r, i) => {
        onProgress?.(i + 1);
        return `ru:${r.text}`;
      }),
    );
  }
}
