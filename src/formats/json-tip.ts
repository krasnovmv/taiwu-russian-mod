/**
 * Adapter for the nested `.json` encyclopedia tips (`CommonTip/**.json`).
 *
 * Only the human-readable fields `title` and `content` are translated. Other
 * string fields are identifiers/enums/references and must NOT change:
 *   - `type`  → structural enum (Default, SimpleContent, Space, …)
 *   - `name`  → identifiers (CombatSkillPowerBonuses01, …)
 *   - `value` → reference tokens ({CharacterFeature.X}, …)
 *
 * Units are keyed by their JSON path (e.g. `paragraphs/0/atoms/1/content`).
 *
 * Sources are parsed with JSON5 because some game tip files are JSONC (they
 * carry `///` comments and one-line atom objects — e.g.
 * CommonTip/Cricket/CricketSkillReplace.json). Apply is text-surgical: a
 * positional scanner finds the exact byte span of each translatable string
 * value and only those spans are replaced, so comments, formatting and every
 * untranslated byte survive verbatim (the raw-layer round-trip guarantee in
 * `model/types.ts`). If the scanner cannot handle a file it falls back to
 * re-serializing the JSON5 tree as 2-space JSON (comments dropped — the
 * in-game CommonTip loader strips them anyway); the round-trip test flags any
 * file that takes the lossy path. Either way the structural guard re-parses
 * the output and confirms the exact set of translatable paths is unchanged.
 */
import JSON5 from "json5";

import type { ApplyOutcome, ExtractResult, FormatAdapter, SourceUnit } from "./adapter.js";

const TRANSLATABLE = new Set(["title", "content"]);

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function collect(node: Json, path: string, out: Map<string, string>): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, path ? `${path}/${i}` : String(i), out));
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const childPath = path ? `${path}/${k}` : k;
      if (typeof v === "string") {
        if (TRANSLATABLE.has(k) && v !== "") out.set(childPath, v);
      } else {
        collect(v, childPath, out);
      }
    }
  }
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Byte span of a string token in the source, including both quotes. */
interface Span {
  start: number;
  end: number;
}

/**
 * Positional scanner over the JSONC source: records the span of every string
 * value sitting under a translatable key, keyed by the same `a/0/b` paths as
 * {@link collect}. Understands the JSON5 subset the game files use (comments,
 * single quotes, unquoted keys, trailing commas); throws on anything else so
 * the caller can fall back to lossy re-serialization.
 */
function scanTranslatableSpans(src: string): Map<string, Span> {
  const spans = new Map<string, Span>();
  let i = 0;
  const err = (msg: string) => new Error(`${msg} at offset ${i}`);

  const skipWs = (): void => {
    while (i < src.length) {
      const c = src[i]!;
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i++;
      } else if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (c === "/" && src[i + 1] === "*") {
        const close = src.indexOf("*/", i + 2);
        if (close === -1) throw err("unterminated block comment");
        i = close + 2;
      } else {
        break;
      }
    }
  };

  const skipString = (): Span => {
    const start = i;
    const quote = src[i]!;
    i++;
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") i += 2;
      else if (c === quote) return { start, end: ++i };
      else i++;
    }
    throw err("unterminated string");
  };

  const object = (path: string): void => {
    i++; // consume '{'
    skipWs();
    if (src[i] === "}") {
      i++;
      return;
    }
    for (;;) {
      skipWs();
      let key: string;
      if (src[i] === '"' || src[i] === "'") {
        const span = skipString();
        key = JSON5.parse(src.slice(span.start, span.end));
      } else {
        const start = i;
        while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) i++;
        if (i === start) throw err("expected object key");
        key = src.slice(start, i);
      }
      skipWs();
      if (src[i] !== ":") throw err("expected ':'");
      i++;
      value(path ? `${path}/${key}` : key);
      skipWs();
      if (src[i] === ",") {
        i++;
        skipWs();
        if (src[i] === "}") {
          i++;
          return;
        }
        continue;
      }
      if (src[i] === "}") {
        i++;
        return;
      }
      throw err("expected ',' or '}'");
    }
  };

  const array = (path: string): void => {
    i++; // consume '['
    skipWs();
    if (src[i] === "]") {
      i++;
      return;
    }
    let idx = 0;
    for (;;) {
      value(path ? `${path}/${idx}` : String(idx));
      idx++;
      skipWs();
      if (src[i] === ",") {
        i++;
        skipWs();
        if (src[i] === "]") {
          i++;
          return;
        }
        continue;
      }
      if (src[i] === "]") {
        i++;
        return;
      }
      throw err("expected ',' or ']'");
    }
  };

  const value = (path: string): void => {
    skipWs();
    const c = src[i];
    if (c === "{") {
      object(path);
    } else if (c === "[") {
      array(path);
    } else if (c === '"' || c === "'") {
      const span = skipString();
      if (TRANSLATABLE.has(lastSegment(path))) spans.set(path, span);
    } else {
      // number / true / false / null keyword literal
      const start = i;
      while (i < src.length && !",]} \t\n\r/".includes(src[i]!)) i++;
      if (i === start) throw err("expected value");
    }
  };

  value("");
  skipWs();
  if (i !== src.length) throw err("trailing content");
  return spans;
}

// Array elements are addressed by numeric string keys (e.g. "atoms/0/content");
// `obj[part]` works for both object and array nodes, and the post-apply guard
// re-validates the full set of translatable paths.
function setAtPath(root: Json, path: string, value: string): boolean {
  const parts = path.split("/");
  let cur: Json = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== "object") return false;
    cur = (cur as Record<string, Json>)[parts[i] ?? ""] ?? null;
  }
  if (cur === null || typeof cur !== "object") return false;
  const last = parts[parts.length - 1] ?? "";
  if (typeof (cur as Record<string, Json>)[last] !== "string") return false;
  (cur as Record<string, Json>)[last] = value;
  return true;
}

export const jsonTipAdapter: FormatAdapter = {
  id: "json-tip",

  extract(enContent, cnContent): ExtractResult {
    let enRoot: Json;
    try {
      enRoot = JSON5.parse(enContent);
    } catch (err) {
      return { units: [], onlyCn: [], warnings: [`invalid JSON: ${(err as Error).message}`] };
    }
    const enMap = new Map<string, string>();
    collect(enRoot, "", enMap);

    const cnMap = new Map<string, string>();
    if (cnContent) {
      try {
        collect(JSON5.parse(cnContent), "", cnMap);
      } catch {
        /* CN may be malformed; just skip the reference */
      }
    }

    const units: SourceUnit[] = [...enMap].map(([key, en]) => ({
      key,
      en,
      cn: cnMap.get(key) ?? null,
    }));
    return { units, onlyCn: [], warnings: [] };
  },

  apply(enContent, translations): ApplyOutcome {
    let root: Json;
    try {
      root = JSON5.parse(enContent);
    } catch (err) {
      return {
        content: enContent,
        applied: 0,
        unsafe: 0,
        unsafeKeys: [],
        guardOk: false,
        guardError: `invalid JSON: ${(err as Error).message}`,
      };
    }

    const before = new Map<string, string>();
    collect(root, "", before);

    // The scanner must agree with the parser on every translatable path,
    // otherwise take the lossy fallback below.
    let spans: Map<string, Span> | null;
    try {
      spans = scanTranslatableSpans(enContent);
    } catch {
      spans = null;
    }
    if (spans) {
      for (const key of before.keys()) {
        if (!spans.has(key)) {
          spans = null;
          break;
        }
      }
    }

    let applied = 0;
    let content: string;
    if (spans) {
      // Surgical apply: splice the translated string tokens into the original
      // text; every byte outside the replaced spans stays exactly as it was.
      const edits: { start: number; end: number; text: string }[] = [];
      for (const [key, ru] of translations) {
        if (!TRANSLATABLE.has(lastSegment(key))) continue;
        const current = before.get(key);
        if (current === undefined || current === ru) continue;
        const span = spans.get(key)!;
        edits.push({ start: span.start, end: span.end, text: JSON.stringify(ru) });
        applied++;
      }
      edits.sort((a, b) => a.start - b.start);
      let out = "";
      let pos = 0;
      for (const e of edits) {
        out += enContent.slice(pos, e.start) + e.text;
        pos = e.end;
      }
      content = out + enContent.slice(pos);
    } else {
      // Lossy fallback: mutate the tree and re-serialize as 2-space JSON.
      // Match the original's trailing newline (the game files have none) so an
      // identity apply on a comment-free file is still byte-exact.
      for (const [key, ru] of translations) {
        if (!TRANSLATABLE.has(lastSegment(key))) continue;
        const current = before.get(key);
        if (current === undefined || current === ru) continue;
        if (setAtPath(root, key, ru)) applied++;
      }
      const trailing = enContent.endsWith("\n") ? "\n" : "";
      content = JSON.stringify(root, null, 2) + trailing;
    }

    // Structural guard: the set of translatable paths must be identical.
    // JSON5 because the surgical path preserves comments in the output.
    let guardOk: boolean;
    let guardError: string | undefined;
    const after = new Map<string, string>();
    try {
      collect(JSON5.parse(content), "", after);
      guardOk = after.size === before.size;
      if (!guardOk) {
        guardError = `translatable path count changed: ${before.size} -> ${after.size}`;
      } else {
        for (const key of before.keys()) {
          if (!after.has(key)) {
            guardOk = false;
            guardError = `path disappeared: ${key}`;
            break;
          }
        }
      }
    } catch (err) {
      guardOk = false;
      guardError = `output no longer parses: ${(err as Error).message}`;
    }

    return { content, applied, unsafe: 0, unsafeKeys: [], guardOk, guardError };
  },
};
