/**
 * Schema-aware adapter for the two encyclopedia INDEX tables —
 * `EncyclopediaContent.tsv` (the article tree) and `EncyclopediaReference.tsv`
 * (the table / hyperlink map). Unlike the plain data tables (handled by
 * {@link tsvAdapter}), these files mix *display text* with *stable identifiers*
 * in fixed column positions, and the game keys navigation off those
 * identifiers. Translating them indiscriminately (as the generic "any cell with
 * a letter" rule does) corrupts the navigation anchors and the cross-file links
 * between the two tables, silently breaking the in-game encyclopedia.
 *
 * Column model (verified across every real row):
 *
 *   Content (13 cols): c0–c4 breadcrumb display · c5 `Heading1…4` marker ·
 *     c6 body prose · c7 `初级/中级/高级` level enum · c8–c10 padding ·
 *     c11 `{表X}` table reference · c12 Chinese node-id path (the nav anchor,
 *     Chinese in EVERY row — even the official EN file). Translatable: c0–c4, c6.
 *
 *   Reference (5–6 cols): c0 node key (`表X` / Chinese) · c1 category (`表`/`超链接`) ·
 *     c2 path-id (pinyin or Chinese path) · c3 `{N}` / `{表X,表Y}` template ·
 *     c4 `{Title,Description,…}` brace-wrapped, comma-separated field list ·
 *     c5 title (some rows). Translatable: c4 (per element) and c5.
 *
 * Everything else is a stable identifier and is preserved byte-for-byte. A
 * structural guard re-verifies, after apply, that every non-translatable column
 * is unchanged and the grid (rows × columns) is intact — turning "navigation
 * survives by luck" into "navigation survives by construction".
 *
 * The c4 field list separates fields with a LITERAL comma; real commas inside a
 * phrase are escaped as `,` (the game unescapes them on display). So
 * elements are split on `,` (never `,`), translated individually, and on
 * apply any literal comma the engine produced inside an element is re-escaped to
 * `,` before rejoining — preserving Russian punctuation AND the field count.
 */
import type { ApplyOutcome, ExtractResult, FormatAdapter, SourceUnit } from "./adapter.js";
import { parseRaw, serializeRaw } from "./paired-txt.js";

const TAG_RE = /<[^>]*>/g;
/** A cell/element is translatable if it has a letter once markup is removed. */
function hasText(cell: string): boolean {
  return /\p{L}/u.test(cell.replace(TAG_RE, ""));
}

function rowsOf(content: string): string[][] {
  return parseRaw(content).lines.map((line) => line.split("\t"));
}

/** A whole cell must never carry a tab/newline (would break the grid). */
const UNSAFE_CELL = /[\t\r\n]/;
/**
 * A list element must not carry a tab/newline (grid) or `{`/`}` (the wrapper).
 * A literal `,` is allowed but re-escaped to `,` on apply, matching the
 * game's own in-field comma convention, so it never splits into a new field.
 */
const UNSAFE_ELEMENT = /[\t\r\n{}]/;
/** The game's escape for an in-field comma (literal six-char sequence). */
const ESCAPED_COMMA = "\\u002c";
/** Match a `{…}`-wrapped list cell (the c4 form). */
const BRACE_LIST = /^\{([\s\S]*)\}$/;

interface EncyclopediaSpec {
  readonly id: string;
  /** True when column `c` holds translatable display text (whole cell). */
  isWholeCol(c: number): boolean;
  /** True when column `c` is a `{a,b,…}` field list translated per element. */
  isListCol(c: number): boolean;
}

const CONTENT_SPEC: EncyclopediaSpec = {
  id: "encyclopedia-content",
  isWholeCol: (c) => c <= 4 || c === 6, // breadcrumb c0–c4, body c6
  isListCol: () => false,
};

const REFERENCE_SPEC: EncyclopediaSpec = {
  id: "encyclopedia-reference",
  isWholeCol: (c) => c === 5, // title
  isListCol: (c) => c === 4, // {Title,Description,…} field list
};

function listElements(cell: string): { inner: string; parts: string[] } | null {
  const m = BRACE_LIST.exec(cell);
  if (!m) return null;
  const inner = m[1] ?? "";
  return { inner, parts: inner.split(",") };
}

function makeAdapter(spec: EncyclopediaSpec): FormatAdapter {
  return {
    id: spec.id,

    extract(enContent, cnContent): ExtractResult {
      const enRows = rowsOf(enContent);
      const cnRows = cnContent ? rowsOf(cnContent) : [];
      const units: SourceUnit[] = [];

      for (let r = 0; r < enRows.length; r++) {
        const row = enRows[r] ?? [];
        const cnRow = cnRows[r] ?? [];
        for (let c = 0; c < row.length; c++) {
          const cell = row[c] ?? "";

          if (spec.isWholeCol(c)) {
            if (!hasText(cell)) continue;
            units.push({ key: `r${r}c${c}`, en: cell, cn: cnRow[c] ?? null });
            continue;
          }

          if (spec.isListCol(c)) {
            const en = listElements(cell);
            if (!en) continue; // not a brace list → treat as stable
            const cn = listElements(cnRow[c] ?? "");
            for (let i = 0; i < en.parts.length; i++) {
              const part = en.parts[i] ?? "";
              if (!hasText(part)) continue;
              units.push({ key: `r${r}c${c}e${i}`, en: part, cn: cn?.parts[i] ?? null });
            }
          }
        }
      }
      return { units, onlyCn: [], warnings: [] };
    },

    apply(enContent, translations): ApplyOutcome {
      const raw = parseRaw(enContent);
      const origRows = raw.lines.map((l) => l.split("\t"));

      let applied = 0;
      let unsafe = 0;
      const unsafeKeys: string[] = [];

      const newLines = origRows.map((cells, r) =>
        cells
          .map((cell, c) => {
            if (spec.isWholeCol(c)) {
              const ru = translations.get(`r${r}c${c}`);
              if (ru == null || ru === cell) return cell;
              if (UNSAFE_CELL.test(ru)) {
                unsafe++;
                unsafeKeys.push(`r${r}c${c}`);
                return cell;
              }
              applied++;
              return ru;
            }

            if (spec.isListCol(c)) {
              const en = listElements(cell);
              if (!en) return cell;
              const parts = en.parts.map((part, i) => {
                const ru = translations.get(`r${r}c${c}e${i}`);
                if (ru == null || ru === part) return part;
                if (UNSAFE_ELEMENT.test(ru)) {
                  unsafe++;
                  unsafeKeys.push(`r${r}c${c}e${i}`);
                  return part;
                }
                applied++;
                // Escape any in-field comma so it stays one field on rejoin.
                return ru.replace(/,/g, ESCAPED_COMMA);
              });
              return `{${parts.join(",")}}`;
            }

            return cell; // stable identifier — never touched
          })
          .join("\t"),
      );

      const content = serializeRaw({ ...raw, lines: newLines });

      // Structural guard: grid intact + every non-translatable column and the
      // per-list field count byte-identical to the original.
      const reRows = parseRaw(content).lines.map((l) => l.split("\t"));
      let guardOk = reRows.length === origRows.length;
      let guardError: string | undefined;
      if (!guardOk) {
        guardError = `row count changed: ${origRows.length} -> ${reRows.length}`;
      } else {
        outer: for (let r = 0; r < origRows.length; r++) {
          const orig = origRows[r] ?? [];
          const next = reRows[r] ?? [];
          if (orig.length !== next.length) {
            guardOk = false;
            guardError = `row ${r} column count changed: ${orig.length} -> ${next.length}`;
            break;
          }
          for (let c = 0; c < orig.length; c++) {
            const o = orig[c] ?? "";
            const n = next[c] ?? "";
            if (spec.isWholeCol(c)) continue; // free to change
            if (spec.isListCol(c)) {
              // Field count (literal commas) must be preserved.
              const oc = (o.match(/,/g) ?? []).length;
              const nc = (n.match(/,/g) ?? []).length;
              if (oc !== nc) {
                guardOk = false;
                guardError = `row ${r} col ${c} field count changed: ${oc} -> ${nc}`;
                break outer;
              }
              continue;
            }
            if (o !== n) {
              guardOk = false;
              guardError = `row ${r} col ${c} (stable identifier) changed: ${JSON.stringify(o)} -> ${JSON.stringify(n)}`;
              break outer;
            }
          }
        }
      }

      return { content, applied, unsafe, unsafeKeys, guardOk, guardError };
    },
  };
}

export const encyclopediaContentAdapter: FormatAdapter = makeAdapter(CONTENT_SPEC);
export const encyclopediaReferenceAdapter: FormatAdapter = makeAdapter(REFERENCE_SPEC);
