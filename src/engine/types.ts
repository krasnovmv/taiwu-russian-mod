/**
 * Engine-agnostic translation contract. Implementations (mock, Yandex, …) only
 * need to translate an array of strings EN→RU. All markup protection, batching
 * policy and validation live above this interface, so engines stay swappable.
 */
export interface TranslationEngine {
  /** Stable identifier recorded in the TM, e.g. "yandex" or "mock". */
  readonly id: string;
  /**
   * Translate a batch of source strings, returning a same-length array of
   * translations (index-aligned). Implementations should preserve any opaque
   * sentinel tokens verbatim; the caller validates this afterwards.
   */
  translate(texts: string[]): Promise<string[]>;
}
