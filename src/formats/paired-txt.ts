/**
 * Adapter for the paired-`.txt` language format used by The Scroll of Taiwu.
 *
 * Layout: alternating lines — odd line = key, even line = value:
 *
 *     Name_0
 *     Iron Ring
 *     FunctionDesc_0
 *     <value, may be empty>
 *
 * Facts established from the real files (all 225 EN files):
 *   - Encoding UTF-8, no BOM, LF line endings (CRLF appears in other families and
 *     is normalised away by {@link parseRaw}).
 *   - In-value line breaks are encoded as the literal token `<NL>`, never a real
 *     newline — so a value is always exactly one physical line and the
 *     key/value pairing never desyncs.
 *   - Values may be empty.
 *   - Every file ends with one trailing blank line.
 */

import type { Entry, ParseResult, RawTextFile } from "../model/types.js";

/**
 * Real keys observed across all 225 files are richer than bare identifiers:
 * they are identifier segments (`[A-Za-z0-9_]+`) joined by single spaces or
 * dots, e.g. `Name_0`, `LK_Combat_Auto_Tips`, `Adv.1 Actions.0 Desc`. Some keys
 * also carry a trailing space, so callers must `.trim()` before testing.
 *
 * This is a heuristic used only to surface key/value desync (e.g. a value that
 * contains a real newline). It is intentionally permissive; the authoritative
 * structural check is cross-language key alignment against the CN files.
 */
const KEY_PATTERN = /^[A-Za-z0-9_]+([ .][A-Za-z0-9_]+)*$/;

/**
 * Lossless parse. Guarantees {@link serializeRaw}`(`{@link parseRaw}`(x)) === x`
 * for ANY input string (proof by construction: split/join are inverses, and the
 * trailing-newline artifact is captured in a flag rather than a phantom line).
 */
export function parseRaw(content: string): RawTextFile {
  const trailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (trailingNewline) {
    // Drop the empty string that `split` appends after a terminal newline.
    lines.pop();
  }
  // Line endings are a property of the file, not of its values: the 2026-07-22
  // game update reflowed part of the event packs to CRLF, and a `\r` left at the
  // end of every line would ride into the values — silently breaking the anchor
  // patterns (`.` never matches `\r`) and changing every source hash. Lift it to
  // a flag instead, but only when *every* line carries one, so the flag alone
  // restores the original bytes; a mixed file keeps its `\r` characters verbatim.
  const crlf = lines.length > 0 && lines.every((l) => l.endsWith("\r"));
  return {
    lines: crlf ? lines.map((l) => l.slice(0, -1)) : lines,
    trailingNewline,
    crlf,
  };
}

/** Exact inverse of {@link parseRaw}. */
export function serializeRaw(file: RawTextFile): string {
  const eol = file.crlf ? "\r\n" : "\n";
  return file.lines.join(eol) + (file.trailingNewline ? eol : "");
}

/**
 * Parse into the semantic key/value view used by the pipeline.
 *
 * Collects non-fatal {@link ParseResult.warnings} instead of throwing, so a
 * single odd file never aborts a whole run — but the round-trip/desync tests
 * treat any warning as a failure during development.
 */
export function parsePairs(content: string): ParseResult {
  const raw = parseRaw(content);
  const { lines } = raw;
  const entries: Entry[] = [];
  const warnings: string[] = [];

  const pairCount = Math.floor(lines.length / 2);
  for (let i = 0; i < pairCount; i++) {
    const keyIndex = i * 2;
    const valueIndex = keyIndex + 1;
    const key = lines[keyIndex] ?? "";
    const value = lines[valueIndex] ?? "";
    if (!KEY_PATTERN.test(key.trim())) {
      warnings.push(
        `line ${keyIndex + 1}: key ${JSON.stringify(truncate(key))} ` +
          `does not match key pattern — possible key/value desync`,
      );
    }
    entries.push({ key, valueIndex, value });
  }

  // An odd number of lines is expected: the single trailing blank line.
  if (lines.length % 2 === 1) {
    const last = lines[lines.length - 1] ?? "";
    if (last !== "") {
      warnings.push(
        `line ${lines.length}: unpaired trailing line is non-empty ` +
          `(${JSON.stringify(truncate(last))})`,
      );
    }
  }

  return { raw, entries, warnings };
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
