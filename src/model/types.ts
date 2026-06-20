/**
 * Core data model shared across format adapters.
 *
 * The design separates two layers on purpose:
 *
 *  1. {@link RawTextFile} — a *lossless* representation whose `serialize ∘ parse`
 *     is byte-identical to the original. Nothing in the translation pipeline is
 *     allowed to break this guarantee (it is enforced by the round-trip test).
 *
 *  2. {@link Entry} — a *semantic* view (key → value) derived from the raw layer
 *     and used by the translation engine. Applying a translation mutates the raw
 *     layer in place, so untouched bytes stay exactly as they were.
 */

/** A `.txt` language file decomposed into exact text lines. */
export interface RawTextFile {
  /** Exact text lines. The final newline (if any) is captured separately. */
  readonly lines: string[];
  /** Whether the original content ended with a trailing newline. */
  readonly trailingNewline: boolean;
}

/** One translatable key/value pair within a paired-`.txt` file. */
export interface Entry {
  /** Stable identifier, e.g. `Name_0`. Aligns across languages (EN/CN/...). */
  readonly key: string;
  /** Index of the value line inside {@link RawTextFile.lines}. */
  readonly valueIndex: number;
  /** Current value text (single physical line; in-text breaks use `<NL>`). */
  readonly value: string;
}

/** Result of parsing a paired-`.txt` file into its semantic view. */
export interface ParseResult {
  readonly raw: RawTextFile;
  readonly entries: Entry[];
  /** Non-fatal anomalies (possible desync, unexpected trailing content). */
  readonly warnings: string[];
}
