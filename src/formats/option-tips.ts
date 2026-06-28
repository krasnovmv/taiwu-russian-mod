/**
 * Adapter for the bundled `EventOptionTips` list (extracted from
 * `GameResources/language_eventoptiontips.uab`). Unlike the key/value packs this
 * is a FLAT, line-aligned text: each physical line is one event-option condition
 * hint (with `{0}`/`{1}` placeholders), and EN / CN / RU share the same line
 * count. There are no keys — the line INDEX is the stable identity.
 *
 * Safety: a translation may never introduce a newline (that would shift every
 * later line), and the rebuilt file must keep the original line count.
 */
import type { ApplyOutcome, ExtractResult, FormatAdapter, SourceUnit } from "./adapter.js";

function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  return {
    lines: body.length === 0 ? [] : body.replace(/\r\n/g, "\n").split("\n"),
    trailingNewline,
  };
}

export const optionTipsAdapter: FormatAdapter = {
  id: "option-tips",

  extract(enContent, cnContent): ExtractResult {
    const en = splitLines(enContent).lines;
    const cn = cnContent ? splitLines(cnContent).lines : [];
    const warnings: string[] = [];
    if (cnContent && cn.length !== en.length) {
      warnings.push(`EN/CN line count mismatch (${en.length} vs ${cn.length})`);
    }
    const units: SourceUnit[] = [];
    for (let i = 0; i < en.length; i++) {
      const text = en[i] ?? "";
      if (text.trim() === "") continue; // blank line: nothing to translate
      units.push({ key: String(i), en: text, cn: cn[i] ?? null });
    }
    return { units, onlyCn: [], warnings };
  },

  apply(enContent, translations): ApplyOutcome {
    const { lines, trailingNewline } = splitLines(enContent);
    let applied = 0;
    let unsafe = 0;
    const unsafeKeys: string[] = [];
    const out = lines.map((line, i) => {
      const ru = translations.get(String(i));
      if (ru == null || ru === line) return line;
      if (ru.includes("\n") || ru.includes("\r")) {
        unsafe++;
        unsafeKeys.push(String(i));
        return line; // would change the line count — keep English
      }
      applied++;
      return ru;
    });
    const guardOk = out.length === lines.length;
    return {
      content: out.join("\n") + (trailingNewline ? "\n" : ""),
      applied,
      unsafe,
      unsafeKeys,
      guardOk,
      guardError: guardOk ? undefined : "line count drift",
    };
  },
};
