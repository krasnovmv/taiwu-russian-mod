/**
 * Build translated file content from the original EN file and the TM.
 *
 * Pure (no filesystem) so it can be tested exhaustively. Safety properties:
 *   - Only VALUE lines are replaced (by index); key lines are never touched.
 *   - A translation containing a real newline would corrupt the strict
 *     key/value alternation, so such units are refused (counted `unsafe`) and
 *     the original value is kept.
 *   - After building, a structural guard re-parses the result and asserts the
 *     key sequence and line count are unchanged. If not, the build is rejected
 *     and nothing should be written.
 *   - Units without a translation keep their original EN value (graceful
 *     partial translation).
 */
import { parsePairs, serializeRaw } from "../formats/paired-txt.js";
import type { TmFile } from "../model/tm.js";

export interface BuildResult {
  content: string;
  /** Units whose RU value was written. */
  applied: number;
  /** Units skipped because the RU value contained a newline (hazard). */
  unsafe: number;
  /** Keys flagged unsafe, for reporting. */
  unsafeKeys: string[];
  /** True when the structural guard passed; never write when false. */
  guardOk: boolean;
  guardError?: string;
}

const NEWLINE_RE = /[\r\n]/;

export function buildTranslatedContent(originalContent: string, tm: TmFile): BuildResult {
  const { raw, entries } = parsePairs(originalContent);
  const originalKeys = entries.map((e) => e.key);

  let applied = 0;
  let unsafe = 0;
  const unsafeKeys: string[] = [];

  for (const entry of entries) {
    const unit = tm.units[entry.key.trim()];
    const ru = unit?.ru;
    if (ru == null || ru === entry.value) continue;
    if (NEWLINE_RE.test(ru)) {
      unsafe++;
      unsafeKeys.push(entry.key.trim());
      continue;
    }
    raw.lines[entry.valueIndex] = ru;
    applied++;
  }

  const content = serializeRaw(raw);

  // Structural guard: re-parse and confirm we changed nothing but values.
  const reparsed = parsePairs(content);
  const newKeys = reparsed.entries.map((e) => e.key);
  let guardOk = true;
  let guardError: string | undefined;
  if (reparsed.raw.lines.length !== raw.lines.length) {
    guardOk = false;
    guardError = `line count changed: ${raw.lines.length} -> ${reparsed.raw.lines.length}`;
  } else if (newKeys.length !== originalKeys.length) {
    guardOk = false;
    guardError = `key count changed: ${originalKeys.length} -> ${newKeys.length}`;
  } else {
    for (let i = 0; i < originalKeys.length; i++) {
      if (originalKeys[i] !== newKeys[i]) {
        guardOk = false;
        guardError = `key at #${i} changed: ${JSON.stringify(originalKeys[i])} -> ${JSON.stringify(newKeys[i])}`;
        break;
      }
    }
  }

  return { content, applied, unsafe, unsafeKeys, guardOk, guardError };
}
