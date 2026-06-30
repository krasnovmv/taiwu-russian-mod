/**
 * Build translated content for a paired-`.txt` file from a `key → RU` map.
 * Used by the paired-txt format adapter (kept in its own file so the adapter
 * stays readable).
 *
 * Pure (no filesystem). Safety properties:
 *   - Only VALUE lines are replaced (by index); key lines are never touched.
 *   - A translation containing a real newline would corrupt the strict
 *     key/value alternation, so such units are refused (counted `unsafe`) and
 *     the original value is kept.
 *   - Keys present in `translations` but ABSENT from the EN file (CN-only keys
 *     the EN pack lacks) are APPENDED as new key/value pairs, so a newer game
 *     string still reaches the output. They go before the conventional trailing
 *     blank line, preserving the strict alternation.
 *   - A structural guard re-parses the result and asserts the key sequence (the
 *     original keys, then any appended ones) and line count match what we built;
 *     otherwise the build is rejected (`guardOk:false`).
 *   - Units without a translation keep their original EN value (graceful
 *     partial translation).
 */
import type { ApplyOutcome } from "./adapter.js";
import { parsePairs, serializeRaw } from "./paired-txt.js";

const NEWLINE_RE = /[\r\n]/;

export function buildTranslatedContent(
  originalContent: string,
  translations: ReadonlyMap<string, string>,
): ApplyOutcome {
  const { raw, entries } = parsePairs(originalContent);
  const originalKeys = entries.map((e) => e.key);
  const enKeys = new Set(originalKeys.map((k) => k.trim()));

  let applied = 0;
  let unsafe = 0;
  const unsafeKeys: string[] = [];

  for (const entry of entries) {
    const ru = translations.get(entry.key.trim());
    if (ru == null || ru === entry.value) continue;
    if (NEWLINE_RE.test(ru)) {
      unsafe++;
      unsafeKeys.push(entry.key.trim());
      continue;
    }
    raw.lines[entry.valueIndex] = ru;
    applied++;
  }

  // Append CN-only keys (in `translations`, not in the EN file) as fresh
  // key/value pairs. A newline in either would break alternation, so refuse it.
  const appendedKeys: string[] = [];
  const newLines: string[] = [];
  for (const [key, ru] of translations) {
    if (enKeys.has(key) || ru == null) continue;
    if (NEWLINE_RE.test(key) || NEWLINE_RE.test(ru)) {
      unsafe++;
      unsafeKeys.push(key);
      continue;
    }
    appendedKeys.push(key);
    newLines.push(key, ru);
    applied++;
  }
  if (newLines.length > 0) {
    // Files conventionally end with one trailing blank line — an odd, unpaired
    // final "" line. Insert before it so the new pairs stay aligned; otherwise
    // append at the end.
    const last = raw.lines.length - 1;
    const hasTrailingBlank = raw.lines.length % 2 === 1 && raw.lines[last] === "";
    raw.lines.splice(hasTrailingBlank ? last : raw.lines.length, 0, ...newLines);
  }

  const content = serializeRaw(raw);

  // Structural guard: re-parse and confirm we changed nothing but values and the
  // intended appends. The expected key sequence is the original keys followed by
  // the appended ones (which land as trailing pairs, before any blank line).
  const expectedKeys = originalKeys.concat(appendedKeys);
  const reparsed = parsePairs(content);
  const newKeys = reparsed.entries.map((e) => e.key);
  const expectedLineCount = raw.lines.length;
  let guardOk = true;
  let guardError: string | undefined;
  if (reparsed.raw.lines.length !== expectedLineCount) {
    guardOk = false;
    guardError = `line count changed: ${expectedLineCount} -> ${reparsed.raw.lines.length}`;
  } else if (newKeys.length !== expectedKeys.length) {
    guardOk = false;
    guardError = `key count changed: ${expectedKeys.length} -> ${newKeys.length}`;
  } else {
    for (let i = 0; i < expectedKeys.length; i++) {
      if (expectedKeys[i] !== newKeys[i]) {
        guardOk = false;
        guardError = `key at #${i} changed: ${JSON.stringify(expectedKeys[i])} -> ${JSON.stringify(newKeys[i])}`;
        break;
      }
    }
  }

  return { content, applied, unsafe, unsafeKeys, guardOk, guardError };
}
