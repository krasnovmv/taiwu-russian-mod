/**
 * Translation-memory (TM) data model.
 *
 * The TM is the durable asset of the project: one JSON file per source file,
 * git-tracked and human-reviewable. It is self-contained — it stores the EN
 * source and CN reference alongside the RU output — so it survives engine
 * changes and lets us detect source drift after a game update via {@link
 * TmUnit.srcHash}.
 */

/** Lifecycle of a single translation unit. */
export type UnitStatus =
  /** No RU translation yet. */
  | "pending"
  /** Auto-translated by an engine; safe to overwrite on glossary/source change. */
  | "machine"
  /** Human-approved; never overwritten automatically (only flagged if source drifts). */
  | "reviewed"
  /** Human-pinned; never touched automatically under any condition. */
  | "locked";

export interface TmUnit {
  /** EN source text (the translation input). */
  en: string;
  /** CN reference text (meaning-of-record), or null if absent in CN. */
  cn: string | null;
  /** RU output, or null while pending. */
  ru: string | null;
  status: UnitStatus;
  /** Hash of (EN source + applicable-glossary-terms salt) when `ru` was produced. */
  srcHash: string;
  /** Engine identifier that produced `ru` (e.g. "yandex"), or null. */
  engine: string | null;
  /** ISO timestamp of the last change to `ru`, or null. */
  updatedAt: string | null;
}

export interface TmFile {
  schemaVersion: number;
  /** Source file name this TM corresponds to, e.g. `Accessory_language.txt`. */
  file: string;
  /** Glossary version active when this file was last synced. */
  glossaryVersion: number;
  /** Units keyed by normalized (trimmed) key, in source order. */
  units: Record<string, TmUnit>;
}

export const TM_SCHEMA_VERSION = 1;
