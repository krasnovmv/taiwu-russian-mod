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
  /**
   * The source text to translate. Normally the English value; for a key that
   * exists only in CN (absent from EN — a newer game string the EN pack hasn't
   * caught up to) this holds the Chinese original instead, flagged by
   * {@link srcLang}.
   */
  en: string;
  cn: string | null;
  /**
   * Language of {@link en}: `"en"` (default, omitted) for the normal EN→RU path,
   * `"zh"` for CN-only keys whose source is Chinese. The engine uses this to pick
   * the source language; the pipeline uses it to skip the EN==CN "neutral" copy.
   */
  srcLang?: "en" | "zh";
}

export interface ExtractResult {
  units: SourceUnit[];
  /**
   * Keys present in CN but absent in EN. Adapters that translate such keys
   * (emitting them as `srcLang:"zh"` units) leave this empty; the rest list them
   * here purely for reporting (they are not output).
   */
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
