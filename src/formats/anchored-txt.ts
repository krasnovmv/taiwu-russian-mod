/**
 * Adapter for the few `.txt` files whose values contain real newlines and so
 * break strict key/value alternation (CricketPolymorphEvent, ImplementedDlc).
 *
 * The CN file parses cleanly, so it is the structural oracle: its key sequence
 * tells us the exact key strings. We then anchor-parse the EN file by locating
 * each key on its own line; everything between two key lines is the (possibly
 * multi-line) value.
 *
 * Safety: every apply first reconstructs the original from its own segments and
 * asserts it is byte-identical (`guardOk: false` otherwise), and re-segments the
 * result to confirm the key sequence did not drift. Nothing is written unless
 * both checks pass.
 */
import type { RawTextFile } from "../model/types.js";
import type { ApplyOutcome, ExtractResult, FormatAdapter, SourceUnit } from "./adapter.js";
import { parsePairs, parseRaw, serializeRaw, splitTrailingNewlines } from "./paired-txt.js";

interface Segment {
  key: string;
  /** The original key line, kept verbatim (may carry a trailing space). */
  keyLineRaw: string;
  /** Value text; may span multiple physical lines (joined with "\n"). */
  value: string;
}

interface Segmentation {
  ok: boolean;
  error?: string;
  prefix: string[];
  segments: Segment[];
}

function segment(lines: string[], keys: ReadonlySet<string>): Segmentation {
  const keyIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keys.has((lines[i] ?? "").trim())) keyIdx.push(i);
  }
  if (keyIdx.length === 0)
    return { ok: false, error: "no key lines found in EN", prefix: [], segments: [] };

  const prefix = lines.slice(0, keyIdx[0]);
  const segments: Segment[] = [];
  for (let j = 0; j < keyIdx.length; j++) {
    const ki = keyIdx[j] ?? 0;
    const end = j + 1 < keyIdx.length ? (keyIdx[j + 1] ?? lines.length) : lines.length;
    segments.push({
      key: (lines[ki] ?? "").trim(),
      keyLineRaw: lines[ki] ?? "",
      value: lines.slice(ki + 1, end).join("\n"),
    });
  }
  return { ok: true, prefix, segments };
}

function reconstruct(prefix: string[], segments: Segment[], raw: RawTextFile): string {
  const lines = [...prefix];
  for (const s of segments) {
    lines.push(s.keyLineRaw);
    lines.push(...s.value.split("\n"));
  }
  return serializeRaw({ ...raw, lines });
}

export const anchoredTxtAdapter: FormatAdapter = {
  id: "anchored-txt",

  extract(enContent, cnContent): ExtractResult {
    if (!cnContent) {
      return {
        units: [],
        onlyCn: [],
        warnings: ["anchored format requires a CN oracle; CN missing"],
      };
    }
    const cnEntries = parsePairs(cnContent).entries;
    const keys = new Set(cnEntries.map((e) => e.key.trim()));
    const cnMap = new Map<string, string>();
    for (const e of cnEntries) {
      const k = e.key.trim();
      if (!cnMap.has(k)) cnMap.set(k, e.value);
    }

    const raw = parseRaw(enContent);
    const seg = segment(raw.lines, keys);
    if (!seg.ok) return { units: [], onlyCn: [], warnings: [seg.error ?? "segmentation failed"] };

    // Refuse to emit units unless we can round-trip the EN file exactly.
    if (reconstruct(seg.prefix, seg.segments, raw) !== enContent) {
      return { units: [], onlyCn: [], warnings: ["anchored round-trip mismatch; not extracting"] };
    }

    const units: SourceUnit[] = seg.segments.map((s) => ({
      key: s.key,
      en: s.value,
      cn: cnMap.get(s.key) ?? null,
    }));
    // CN-only keys (a newer DLC the EN pack lacks) are translated from Chinese,
    // same convention as the paired-txt adapter; `apply` appends them.
    const enKeys = new Set(seg.segments.map((s) => s.key));
    for (const [key, cn] of cnMap) {
      if (!enKeys.has(key)) units.push({ key, en: cn, cn: null, srcLang: "zh" });
    }
    return { units, onlyCn: [], warnings: [] };
  },

  apply(enContent, translations): ApplyOutcome {
    const fail = (guardError: string): ApplyOutcome => ({
      content: enContent,
      applied: 0,
      unsafe: 0,
      unsafeKeys: [],
      guardOk: false,
      guardError,
    });

    const keys = new Set(translations.keys());
    const raw = parseRaw(enContent);
    const seg = segment(raw.lines, keys);
    if (!seg.ok) return fail(seg.error ?? "segmentation failed");

    // Identity round-trip: rebuilding from segments must reproduce the original.
    if (reconstruct(seg.prefix, seg.segments, raw) !== enContent) {
      return fail("anchored round-trip mismatch");
    }

    let applied = 0;
    const newSegments = seg.segments.map((s) => {
      const ru = translations.get(s.key);
      if (ru == null || ru === s.value) return s;
      applied++;
      return { ...s, value: ru };
    });

    // Append keys absent from EN (CN-only) as new segments. The file's trailing
    // blank lines belong to the last value; move them past the appended ones.
    const enKeys = new Set(seg.segments.map((s) => s.key));
    const appended: Segment[] = [];
    for (const [key, ru] of translations) {
      if (enKeys.has(key) || ru == null) continue;
      appended.push({ key, keyLineRaw: key, value: ru });
      applied++;
    }
    if (appended.length > 0) {
      const last = newSegments[newSegments.length - 1]!;
      const { body, tail } = splitTrailingNewlines(last.value);
      newSegments[newSegments.length - 1] = { ...last, value: body };
      appended[appended.length - 1]!.value += tail;
      newSegments.push(...appended);
    }

    const content = reconstruct(seg.prefix, newSegments, raw);

    // Post-guard: re-segmenting must yield the expected key sequence (a
    // translation that introduced a line equal to a key would desync).
    const reseg = segment(parseRaw(content).lines, keys);
    const sameKeys =
      reseg.ok &&
      reseg.segments.length === newSegments.length &&
      reseg.segments.every((s, i) => s.key === newSegments[i]?.key);
    if (!sameKeys) return fail("post-apply key sequence drift");

    return { content, applied, unsafe: 0, unsafeKeys: [], guardOk: true };
  },
};
