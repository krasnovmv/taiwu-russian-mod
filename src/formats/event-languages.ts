/**
 * Adapter for the quest/event text under `Event_Languages` (the game's
 * `Event/EventLanguages` folder, outside StreamingAssets).
 *
 * Layout — a flat list of event blocks, each keyed by a GUID:
 *
 *     - EventGuid : b1941e5e-…
 *     \t- EventName : AncientTomb_event_触发和石碑互动
 *     \t\t-- EventContent : <Character key=RoleTaiwu str=Name/> enters…<NL>…
 *     \t\t-- Option_1 : (Examine the stele closely...)
 *
 * Facts established from the real files (466 EN packages):
 *   - UTF-8, no BOM, LF, trailing newline.
 *   - EN/CN/KO each share one directory, distinguished by filename suffix.
 *   - EN and KO carry no header; CN prepends `- Group/-GroupName/-Language` lines.
 *   - The GUID order differs between EN and CN, so the CN reference is matched by
 *     GUID, never by position.
 *   - Most values are inline after `: `, but a value MAY be empty there and
 *     continue on the following physical lines until the next marker — including
 *     real newlines (not just the `<NL>` token). So this is an anchored format,
 *     parsed like {@link anchoredTxtAdapter}: marker lines are the anchors and a
 *     value spans to the next anchor.
 *
 * Only `EventContent` and `Option_N` are player-facing and translated. The
 * `EventGuid`/`EventName` (and CN-only header) markers are structural anchors
 * kept verbatim. Every apply round-trips the source from its own segments and
 * re-segments the result, refusing to write on any structural drift.
 */
import type { ApplyOutcome, ExtractResult, FormatAdapter, SourceUnit } from "./adapter.js";
import { parseRaw, serializeRaw } from "./paired-txt.js";

/** Marker line: `<indent><dashes> <Marker> : <inline value>`. */
const ANCHOR_RE =
  /^(\s*-{1,2} )(EventGuid|EventName|EventContent|Option_\d+|Group|GroupName|Language)( : )(.*)$/;

interface Segment {
  /** Marker keyword (e.g. `EventContent`, `Option_1`, `EventGuid`). */
  marker: string;
  /** The line up to and including the `: ` separator, kept verbatim. */
  prefix: string;
  /** Value text; may be empty and may span multiple physical lines ("\n"). */
  value: string;
}

interface Segmentation {
  ok: boolean;
  error?: string;
  /** Lines before the first anchor (CN header / blank lines); EN/KO: none. */
  prefix: string[];
  segments: Segment[];
}

/** True for the player-facing markers we translate. */
function isTranslatable(marker: string): boolean {
  return marker === "EventContent" || /^Option_\d+$/.test(marker);
}

/** Split raw lines into the leading prefix and one segment per marker line. */
function segment(lines: string[]): Segmentation {
  const anchors: { index: number; marker: string; prefix: string; inline: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ANCHOR_RE.exec(lines[i] ?? "");
    if (m) anchors.push({ index: i, marker: m[2]!, prefix: m[1]! + m[2]! + m[3]!, inline: m[4]! });
  }
  if (anchors.length === 0)
    return { ok: false, error: "no marker lines found", prefix: [], segments: [] };

  const prefix = lines.slice(0, anchors[0]!.index);
  const segments: Segment[] = anchors.map((a, j) => {
    const end = j + 1 < anchors.length ? anchors[j + 1]!.index : lines.length;
    // The value is the inline remainder plus any continuation lines up to the
    // next anchor, joined back with the newlines that separated them.
    const cont = lines.slice(a.index + 1, end);
    const value = cont.length > 0 ? [a.inline, ...cont].join("\n") : a.inline;
    return { marker: a.marker, prefix: a.prefix, value };
  });
  return { ok: true, prefix, segments };
}

/** Exact inverse of {@link segment} for a given trailing-newline flag. */
function reconstruct(prefix: string[], segments: Segment[], trailingNewline: boolean): string {
  const lines = [...prefix];
  for (const s of segments) lines.push(...(s.prefix + s.value).split("\n"));
  return serializeRaw({ lines, trailingNewline });
}

interface KeyedSegment {
  seg: Segment;
  /** Stable key (`<guid>/<marker>`) for a translatable segment, else null. */
  key: string | null;
}

/** Pair each segment with its key (`<guid>/<marker>`), tracking the current GUID. */
function keyedSegments(segments: Segment[]): KeyedSegment[] {
  let guid: string | null = null;
  return segments.map((seg) => {
    if (seg.marker === "EventGuid") {
      guid = seg.value.trim();
      return { seg, key: null };
    }
    const key = guid !== null && isTranslatable(seg.marker) ? `${guid}/${seg.marker}` : null;
    return { seg, key };
  });
}

export const eventLanguagesAdapter: FormatAdapter = {
  id: "event-languages",

  extract(enContent, cnContent): ExtractResult {
    const enRaw = parseRaw(enContent);
    const seg = segment(enRaw.lines);
    if (!seg.ok) return { units: [], onlyCn: [], warnings: [seg.error ?? "segmentation failed"] };

    // Refuse to emit units unless the EN file round-trips exactly.
    if (reconstruct(seg.prefix, seg.segments, enRaw.trailingNewline) !== enContent) {
      return { units: [], onlyCn: [], warnings: ["event round-trip mismatch; not extracting"] };
    }

    // CN reference, keyed by GUID (order differs from EN).
    const cnMap = new Map<string, string>();
    if (cnContent) {
      const cnSeg = segment(parseRaw(cnContent).lines);
      if (cnSeg.ok) {
        for (const { seg: s, key } of keyedSegments(cnSeg.segments)) {
          if (key !== null && !cnMap.has(key)) cnMap.set(key, s.value);
        }
      }
    }

    const units: SourceUnit[] = [];
    const seen = new Set<string>();
    for (const { seg: s, key } of keyedSegments(seg.segments)) {
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      units.push({ key, en: s.value, cn: cnMap.has(key) ? (cnMap.get(key) ?? null) : null });
    }
    const onlyCn = [...cnMap.keys()].filter((k) => !seen.has(k));
    return { units, onlyCn, warnings: [] };
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

    const raw = parseRaw(enContent);
    const seg = segment(raw.lines);
    if (!seg.ok) return fail(seg.error ?? "segmentation failed");

    // Identity round-trip: rebuilding from segments must reproduce the original.
    if (reconstruct(seg.prefix, seg.segments, raw.trailingNewline) !== enContent) {
      return fail("event round-trip mismatch");
    }

    let applied = 0;
    const newSegments = keyedSegments(seg.segments).map(({ seg: s, key }) => {
      if (key === null) return s;
      const ru = translations.get(key);
      if (ru == null || ru === s.value) return s;
      applied++;
      return { ...s, value: ru };
    });

    const content = reconstruct(seg.prefix, newSegments, raw.trailingNewline);

    // Post-guard: re-segmenting must reproduce the same anchor sequence — a
    // translation that injected a marker-shaped line would desync the file.
    const reseg = segment(parseRaw(content).lines);
    const sameShape =
      reseg.ok &&
      reseg.segments.length === seg.segments.length &&
      reseg.segments.every((s, i) => s.prefix === seg.segments[i]?.prefix);
    if (!sameShape) return fail("post-apply anchor sequence drift");

    return { content, applied, unsafe: 0, unsafeKeys: [], guardOk: true };
  },
};
