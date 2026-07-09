/**
 * Pure CSV ↔ glossary transforms shared by the `glossary:pull` CLI and its tests.
 * No file IO: every function takes and returns strings or plain data, so the
 * pipeline round-trips deterministically. `glossaryToCsv` and `parseSheet` +
 * `buildFile` are inverse operations — exporting a glossary and importing the
 * result reproduces the original file byte-for-byte. See src/cli/glossary-pull.ts
 * for the thin IO wrapper.
 *
 * CSV shape: header `EN,RU,feed,cs,comment` (case-insensitive; `feed`/`cs`/
 * `comment` optional). A row with empty EN/RU but a `comment` is a section
 * divider that opens a group; the terms beneath it (until the next divider)
 * belong to it. A non-empty `cs` cell marks the term case-sensitive.
 */

/** A glossary value in `data/glossary.json5`: a bare RU string, or `{ ru, feed?, cs? }`. */
export type GlossaryValue = string | { ru: string; feed?: string; cs?: boolean };

/** One term row from the sheet, already trimmed. */
export interface Term {
  en: string;
  ru: string;
  feed: string;
  cs: boolean;
  line: number; // 1-based row number in the sheet, for messages
}

/** The sheet parsed into ordered sections plus any pre-section terms. */
export interface Sheet {
  preamble: Term[]; // terms appearing before the first divider (usually none)
  sections: { label: string; terms: Term[] }[];
  invalid: Term[]; // rows missing EN or RU
  dupes: { en: string; line: number }[]; // EN repeated (case-insensitive); dropped
}

/**
 * Minimal RFC-4180 CSV parser: handles quoted fields, `""` escapes, and commas /
 * newlines inside quotes. Returns rows of raw string cells (no trimming).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // Strip a leading UTF-8 BOM Google Sheets sometimes prepends.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  // Flush the trailing cell/row if the file didn't end with a newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Map header names → column indices; throws if EN/RU columns are missing. */
export function resolveColumns(header: string[]): {
  en: number;
  ru: number;
  feed: number;
  cs: number;
  comment: number;
} {
  const idx = (name: string): number => header.findIndex((h) => h.trim().toLowerCase() === name);
  const en = idx("en");
  const ru = idx("ru");
  if (en < 0 || ru < 0) {
    throw new Error(`CSV header must contain "EN" and "RU" columns (got: ${header.join(", ")}).`);
  }
  return { en, ru, feed: idx("feed"), cs: idx("cs"), comment: idx("comment") };
}

/**
 * Parse CSV text into ordered sections. A divider row opens a new section; each
 * term row joins the section above it. EN is deduped case-insensitively (first
 * occurrence wins); rows missing EN or RU are collected as `invalid`.
 */
export function parseSheet(csv: string): Sheet {
  const grid = parseCsv(csv);
  const header = grid[0];
  const sheet: Sheet = { preamble: [], sections: [], invalid: [], dupes: [] };
  if (!header) return sheet;
  const cols = resolveColumns(header);
  const seen = new Set<string>();
  let current: { label: string; terms: Term[] } | null = null;

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells) continue;
    const en = (cells[cols.en] ?? "").trim();
    const ru = (cells[cols.ru] ?? "").trim();
    const feed = cols.feed >= 0 ? (cells[cols.feed] ?? "").trim() : "";
    const cs = cols.cs >= 0 && (cells[cols.cs] ?? "").trim() !== "";
    const comment = cols.comment >= 0 ? (cells[cols.comment] ?? "").trim() : "";
    const line = r + 1;

    if (!en && !ru) {
      if (comment) {
        current = { label: comment, terms: [] };
        sheet.sections.push(current);
      }
      continue; // spacing or divider, not a term
    }
    if (!en || !ru) {
      sheet.invalid.push({ en, ru, feed, cs, line });
      continue;
    }
    const key = en.toLowerCase();
    if (seen.has(key)) {
      sheet.dupes.push({ en, line });
      continue;
    }
    seen.add(key);
    const term: Term = { en, ru, feed, cs, line };
    if (current) current.terms.push(term);
    else sheet.preamble.push(term);
  }
  return sheet;
}

/** Flatten a sheet to its terms in order (preamble first, then each section). */
export function flattenSheet(sheet: Sheet): Term[] {
  return [...sheet.preamble, ...sheet.sections.flatMap((s) => s.terms)];
}

/** Render a `{ ru, feed?, cs? }` value the way the hand-written entries are formatted. */
function renderObject(ru: string, feed: string, cs: boolean): string {
  const parts = [`"ru": ${JSON.stringify(ru)}`];
  if (feed) parts.push(`"feed": ${JSON.stringify(feed)}`);
  if (cs) parts.push(`"cs": true`);
  return `{ ${parts.join(", ")} }`;
}

/** `"En": value` text for one term (no indent, no trailing comma). */
function renderTerm(en: string, ru: string, feed: string, cs: boolean): string {
  return `${JSON.stringify(en)}: ${feed || cs ? renderObject(ru, feed, cs) : JSON.stringify(ru)}`;
}

/** Render a preserved metadata value (e.g. the `_comment` string). */
function renderValue(v: GlossaryValue): string {
  return typeof v === "string"
    ? JSON.stringify(v)
    : renderObject(v.ru, v.feed ?? "", v.cs === true);
}

/**
 * Rebuild the whole glossary file from the sheet, mirroring its order and content.
 * `existing` supplies the preserved `_comment` metadata and the label→slug map used
 * to keep `_section_*` keys stable when the section order is unchanged.
 */
export function buildFile(existing: Record<string, GlossaryValue>, sheet: Sheet): string {
  const meta = Object.entries(existing).filter(
    ([k]) => k.startsWith("_") && !k.startsWith("_section"),
  );
  const slugByLabel = new Map<string, string>();
  for (const [k, v] of Object.entries(existing)) {
    if (k.startsWith("_section")) {
      const label = (typeof v === "string" ? v : v.ru).trim();
      slugByLabel.set(label, k.replace(/^_section_\d+_?/, ""));
    }
  }

  type Unit = { blank: true } | { text: string };
  const body: Unit[] = [];
  for (const [k, v] of meta) body.push({ text: `${JSON.stringify(k)}: ${renderValue(v)}` });
  const emit = (t: Term): void => void body.push({ text: renderTerm(t.en, t.ru, t.feed, t.cs) });

  if (sheet.preamble.length > 0) {
    body.push({ blank: true });
    sheet.preamble.forEach(emit);
  }
  sheet.sections.forEach((sec, i) => {
    body.push({ blank: true });
    const slug = slugByLabel.get(sec.label.trim()) ?? "";
    const num = String(i + 1).padStart(2, "0");
    const key = slug ? `_section_${num}_${slug}` : `_section_${num}`;
    body.push({ text: `${JSON.stringify(key)}: ${JSON.stringify(sec.label)}` });
    sec.terms.forEach(emit);
  });

  // Every entry gets a trailing comma except the last one before `}`.
  let lastEntry = -1;
  body.forEach((u, i) => {
    if ("text" in u) lastEntry = i;
  });
  const lines = ["{"];
  body.forEach((u, i) => {
    lines.push("blank" in u ? "" : `  ${u.text}${i === lastEntry ? "" : ","}`);
  });
  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * Serialize a parsed glossary to CSV (the inverse of parseSheet + buildFile).
 * `_section_*` keys become divider rows (label in `comment`, preceded by a blank
 * row); other `_`-metadata keys are dropped.
 */
export function glossaryToCsv(parsed: Record<string, GlossaryValue>): string {
  const esc = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["EN,RU,feed,cs,comment"];
  for (const [en, value] of Object.entries(parsed)) {
    if (en.startsWith("_section")) {
      const label = typeof value === "string" ? value : value.ru;
      lines.push("", `,,,,${esc(label)}`);
      continue;
    }
    if (en.startsWith("_")) continue;
    const ru = typeof value === "string" ? value : value.ru;
    const feed = typeof value === "string" ? "" : (value.feed ?? "");
    const cs = typeof value !== "string" && value.cs === true;
    lines.push([esc(en), esc(ru), esc(feed), cs ? "true" : "", ""].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Count the real (non-`_`) terms in a parsed glossary. */
export function countTerms(parsed: Record<string, GlossaryValue>): number {
  return Object.keys(parsed).filter((k) => !k.startsWith("_")).length;
}

export interface GlossaryDiff {
  added: Term[];
  removed: { en: string; ru: string }[];
  changed: { from: { en: string; ru: string; feed: string; cs: boolean }; to: Term }[];
}

/** Diff a sheet against the current glossary (case-insensitive on EN). */
export function diffGlossary(existing: Record<string, GlossaryValue>, sheet: Sheet): GlossaryDiff {
  const oldTerms = new Map<string, { en: string; ru: string; feed: string; cs: boolean }>();
  for (const [k, v] of Object.entries(existing)) {
    if (k.startsWith("_")) continue;
    oldTerms.set(k.toLowerCase(), {
      en: k,
      ru: typeof v === "string" ? v : v.ru,
      feed: typeof v === "string" ? "" : (v.feed ?? ""),
      cs: typeof v !== "string" && v.cs === true,
    });
  }
  const newTerms = flattenSheet(sheet);
  const newByKey = new Map(newTerms.map((t) => [t.en.toLowerCase(), t]));
  return {
    added: newTerms.filter((t) => !oldTerms.has(t.en.toLowerCase())),
    removed: [...oldTerms.values()]
      .filter((o) => !newByKey.has(o.en.toLowerCase()))
      .map((o) => ({ en: o.en, ru: o.ru })),
    changed: newTerms.flatMap((t) => {
      const o = oldTerms.get(t.en.toLowerCase());
      return o && (o.ru !== t.ru || o.feed !== t.feed || o.cs !== t.cs) ? [{ from: o, to: t }] : [];
    }),
  };
}
