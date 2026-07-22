/**
 * Adapter for the `.tsv` encyclopedia tables (`EncyclopediaAssets/*.tsv`).
 *
 * Tab-separated rows, no header, variable column count. Cells may hold rich-text
 * markup (`<align="center">…</align>`) or pure numbers/percentages. Only cells
 * containing real letters (outside markup) are emitted as translatable units,
 * keyed by `r{row}c{col}`. CN cells are joined positionally when present.
 *
 * Reuses the lossless line layer ({@link parseRaw}/{@link serializeRaw}); a
 * translation containing a tab or newline would break the table grid, so it is
 * refused. A structural guard re-checks row and per-row column counts.
 */
import type { ApplyOutcome, ExtractResult, FormatAdapter } from "./adapter.js";
import { parseRaw, serializeRaw } from "./paired-txt.js";

const TAG_RE = /<[^>]*>/g;
const TAB_OR_NEWLINE = /[\t\r\n]/;

/** A cell is translatable if it has a letter once markup tags are removed. */
function hasText(cell: string): boolean {
  return /\p{L}/u.test(cell.replace(TAG_RE, ""));
}

function rowsOf(content: string): string[][] {
  return parseRaw(content).lines.map((line) => line.split("\t"));
}

export const tsvAdapter: FormatAdapter = {
  id: "tsv",

  extract(enContent, cnContent): ExtractResult {
    const enRows = rowsOf(enContent);
    const cnRows = cnContent ? rowsOf(cnContent) : [];

    const units = [];
    for (let r = 0; r < enRows.length; r++) {
      const row = enRows[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c] ?? "";
        if (!hasText(cell)) continue;
        units.push({ key: `r${r}c${c}`, en: cell, cn: cnRows[r]?.[c] ?? null });
      }
    }
    return { units, onlyCn: [], warnings: [] };
  },

  apply(enContent, translations): ApplyOutcome {
    const raw = parseRaw(enContent);
    const colCounts = raw.lines.map((l) => l.split("\t").length);

    let applied = 0;
    let unsafe = 0;
    const unsafeKeys: string[] = [];

    const newLines = raw.lines.map((line, r) => {
      const cells = line.split("\t");
      return cells
        .map((cell, c) => {
          const ru = translations.get(`r${r}c${c}`);
          if (ru == null || ru === cell) return cell;
          if (TAB_OR_NEWLINE.test(ru)) {
            unsafe++;
            unsafeKeys.push(`r${r}c${c}`);
            return cell;
          }
          applied++;
          return ru;
        })
        .join("\t");
    });

    const content = serializeRaw({ ...raw, lines: newLines });

    // Structural guard: row count and per-row column counts must be unchanged.
    const reLines = parseRaw(content).lines;
    let guardOk = reLines.length === raw.lines.length;
    let guardError: string | undefined;
    if (!guardOk) {
      guardError = `row count changed: ${raw.lines.length} -> ${reLines.length}`;
    } else {
      for (let r = 0; r < reLines.length; r++) {
        const cols = (reLines[r] ?? "").split("\t").length;
        if (cols !== colCounts[r]) {
          guardOk = false;
          guardError = `row ${r} column count changed: ${colCounts[r]} -> ${cols}`;
          break;
        }
      }
    }

    return { content, applied, unsafe, unsafeKeys, guardOk, guardError };
  },
};
