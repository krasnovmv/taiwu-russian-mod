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
 *   - UTF-8, no BOM, trailing newline. Line endings are LF or CRLF (the
 *     2026-07-22 update reflowed 207 of the packages to CRLF); {@link parseRaw}
 *     lifts that to a flag, so the anchors below always see a bare line.
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
import type { RawTextFile } from "../model/types.js";
import type { ApplyOutcome, ExtractResult, FormatAdapter, SourceUnit } from "./adapter.js";
import { parseRaw, serializeRaw, splitTrailingNewlines } from "./paired-txt.js";

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

const OPTION_RE = /^Option_\d+$/;

/** True for the player-facing markers we translate. */
function isTranslatable(marker: string): boolean {
  return marker === "EventContent" || OPTION_RE.test(marker);
}

/** `<guid>/<marker>` key → its GUID. */
function guidOf(key: string): string {
  return key.slice(0, key.lastIndexOf("/"));
}

/** `<guid>/<marker>` key → its marker. */
function markerOf(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

function isOptionKey(key: string): boolean {
  return OPTION_RE.test(markerOf(key));
}

function optionNumber(key: string): number {
  return Number(key.slice(key.lastIndexOf("_") + 1));
}

/** Non-blank option values per GUID (`Option_N` number → trimmed text). */
function optionsByGuid(
  entries: Iterable<[string | null, string]>,
): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  for (const [key, value] of entries) {
    if (key === null || !isOptionKey(key) || !value.trim()) continue;
    const guid = guidOf(key);
    if (!out.has(guid)) out.set(guid, new Map());
    out.get(guid)!.set(optionNumber(key), value.trim());
  }
  return out;
}

/**
 * Language-independent shape of an event's options: which numbers exist and
 * which of them repeat an earlier one ("1:0 2:0 3:2" = options 1 and 2 share a
 * text). EN and CN agree on it unless the EN options are out of date.
 */
function optionShape(options: Map<number, string> | undefined): string {
  const sorted = [...(options ?? [])].sort(([a], [b]) => a - b);
  const texts = sorted.map(([, text]) => text);
  return sorted.map(([n, text]) => `${n}:${texts.indexOf(text)}`).join(" ");
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

/** Exact inverse of {@link segment} for a given file's line layout. */
function reconstruct(prefix: string[], segments: Segment[], raw: RawTextFile): string {
  const lines = [...prefix];
  for (const s of segments) lines.push(...(s.prefix + s.value).split("\n"));
  return serializeRaw({ ...raw, lines });
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
    if (reconstruct(seg.prefix, seg.segments, enRaw) !== enContent) {
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

    const enKeyed = keyedSegments(seg.segments);
    const enGuids = new Set(enKeyed.flatMap(({ key }) => (key === null ? [] : [guidOf(key)])));
    const fromCn = (key: string): SourceUnit | null => {
      const cn = cnMap.get(key);
      // Drop the blank line that separates CN events; apply keeps the EN one.
      return cn?.trim() ? { key, en: cn.replace(/\n+$/, ""), cn: null, srcLang: "zh" } : null;
    };
    // An event whose EN option set disagrees with CN is a stale EN event: the
    // developers (who write in Chinese) inserted, removed or reordered options,
    // so EN Option_N no longer lines up with the game's Option_N. CN is the
    // truth; translate every option of such an event from Chinese.
    const enOptions = optionsByGuid(enKeyed.map(({ seg: s, key }) => [key, s.value]));
    const cnOptions = optionsByGuid(cnMap);
    const stale = new Set(
      [...cnOptions]
        .filter(
          ([guid, cn]) => enGuids.has(guid) && optionShape(cn) !== optionShape(enOptions.get(guid)),
        )
        .map(([guid]) => guid),
    );

    const units: SourceUnit[] = [];
    const seen = new Set<string>();
    for (const { seg: s, key } of enKeyed) {
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      const zh = stale.has(guidOf(key)) && isOptionKey(key) ? fromCn(key) : null;
      units.push(zh ?? { key, en: s.value, cn: cnMap.get(key) ?? null });
    }
    // The stale events' extra options; `apply` inserts them into their event.
    for (const key of cnMap.keys()) {
      if (seen.has(key) || !stale.has(guidOf(key))) continue;
      seen.add(key);
      const zh = fromCn(key);
      if (zh) units.push(zh);
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
    if (reconstruct(seg.prefix, seg.segments, raw) !== enContent) {
      return fail("event round-trip mismatch");
    }

    let applied = 0;
    const keyed = keyedSegments(seg.segments);
    const enKeys = new Set(keyed.flatMap(({ key }) => (key === null ? [] : [key])));
    // Options the EN event lacks (a stale EN event, see `extract`), per GUID.
    const extra = new Map<string, string[]>();
    for (const [key, ru] of translations) {
      if (enKeys.has(key) || ru == null || !isOptionKey(key)) continue;
      const guid = guidOf(key);
      extra.set(guid, [...(extra.get(guid) ?? []), key]);
    }

    const newSegments: Segment[] = [];
    // The current event: its GUID and its last translatable segment, whose
    // line prefix the inserted options copy.
    let block: { guid: string; template: Segment } | null = null;
    // Close the current event block: insert its extra options after its last
    // segment, moving that segment's trailing blank lines past them.
    const flush = (): void => {
      const keys = block ? extra.get(block.guid) : undefined;
      if (block && keys) {
        const last = newSegments[newSegments.length - 1]!;
        const { body, tail } = splitTrailingNewlines(last.value);
        newSegments[newSegments.length - 1] = { ...last, value: body };
        const { template } = block;
        for (const key of keys.sort((a, b) => optionNumber(a) - optionNumber(b))) {
          const marker = markerOf(key);
          const prefix = template.prefix.replace(template.marker, marker);
          newSegments.push({ marker, prefix, value: translations.get(key)! });
          applied++;
        }
        newSegments[newSegments.length - 1]!.value += tail;
      }
      block = null;
    };
    for (const { seg: s, key } of keyed) {
      if (s.marker === "EventGuid") flush();
      if (key !== null) block = { guid: guidOf(key), template: s };
      const ru = key === null ? null : translations.get(key);
      if (ru == null || ru === s.value) {
        newSegments.push(s);
        continue;
      }
      applied++;
      // A CN-sourced option (stale event) lacks the EN value's trailing blank
      // lines, which separate this event from the next; keep them.
      const { tail } = splitTrailingNewlines(s.value);
      newSegments.push({ ...s, value: ru.endsWith("\n") ? ru : ru + tail });
    }
    flush();

    const content = reconstruct(seg.prefix, newSegments, raw);

    // Post-guard: re-segmenting must reproduce the expected anchor sequence — a
    // translation that injected a marker-shaped line would desync the file.
    const reseg = segment(parseRaw(content).lines);
    const sameShape =
      reseg.ok &&
      reseg.segments.length === newSegments.length &&
      reseg.segments.every((s, i) => s.prefix === newSegments[i]?.prefix);
    if (!sameShape) return fail("post-apply anchor sequence drift");

    return { content, applied, unsafe: 0, unsafeKeys: [], guardOk: true };
  },
};
