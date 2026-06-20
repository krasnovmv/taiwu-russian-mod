/**
 * Engine-agnostic translation contract. All markup protection, batching policy
 * and validation live above this interface, so engines stay swappable.
 */

/** One thing to translate, plus optional reference context. */
export interface TranslationRequest {
  /** The (already markup-masked) source text to translate. */
  text: string;
  /**
   * Optional original-language reference (the CN text) for meaning context.
   * Machine engines (Yandex) ignore it; LLM engines use it to disambiguate,
   * since the EN source is itself machine-translated from CN.
   */
  reference?: string | null;
}

/** Reports cumulative completed requests, for progress display. */
export type ProgressCallback = (completed: number) => void;

export interface TranslationEngine {
  /** Stable identifier recorded in the TM, e.g. "yandex" or "lmstudio". */
  readonly id: string;
  /**
   * How many units the pipeline translates before flushing a TM checkpoint.
   * Smaller = less work lost if interrupted; tune per engine speed (a slow local
   * LLM wants a small value, fast batched MT a larger one).
   */
  readonly checkpointSize: number;
  /**
   * Translate a batch of requests, returning a same-length array of
   * translations (index-aligned). Implementations should preserve any opaque
   * sentinel tokens in `text` verbatim; the caller validates this afterwards.
   * `onProgress` (optional) is called with the running completed count.
   */
  translate(requests: TranslationRequest[], onProgress?: ProgressCallback): Promise<string[]>;
}
