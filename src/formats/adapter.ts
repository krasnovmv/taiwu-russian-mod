/**
 * Format adapter abstraction.
 *
 * Each source format (paired `.txt`, `.tsv` tables, nested `.json`, the anchored
 * multiline `.txt`) implements this interface, so the alignment, translation,
 * coverage and apply layers stay format-agnostic. An adapter does two things:
 *
 *  - extract translatable units (stable key → EN text, plus CN reference);
 *  - apply translations back into the original content, with a structural guard
 *    that refuses to produce corrupted output.
 */

/** One translatable unit within a file. */
export interface SourceUnit {
  /** Stable identity within the file (key, path or row/col coordinate). */
  key: string;
  en: string;
  cn: string | null;
}

export interface ExtractResult {
  units: SourceUnit[];
  /** Keys present in CN but absent in EN (nothing to output). */
  onlyCn: string[];
  /** Non-fatal anomalies surfaced for review. */
  warnings: string[];
}

export interface ApplyOutcome {
  content: string;
  /** Units whose translation was written. */
  applied: number;
  /** Units skipped because applying them would corrupt the file. */
  unsafe: number;
  unsafeKeys: string[];
  /** True when the structural guard passed; never write when false. */
  guardOk: boolean;
  guardError?: string;
}

export interface FormatAdapter {
  readonly id: string;
  /** Parse EN (and optional CN) content into translatable units. */
  extract(enContent: string, cnContent: string | null): ExtractResult;
  /** Rebuild content with `translations` (key → RU) applied. */
  apply(enContent: string, translations: ReadonlyMap<string, string>): ApplyOutcome;
}
