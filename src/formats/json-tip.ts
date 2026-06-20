/**
 * Adapter for the nested `.json` encyclopedia tips (`CommonTip/**.json`).
 *
 * Only the human-readable fields `title` and `content` are translated. Other
 * string fields are identifiers/enums/references and must NOT change:
 *   - `type`  → structural enum (Default, SimpleContent, Space, …)
 *   - `name`  → identifiers (CombatSkillPowerBonuses01, …)
 *   - `value` → reference tokens ({CharacterFeature.X}, …)
 *
 * Units are keyed by their JSON path (e.g. `paragraphs/0/atoms/1/content`). The
 * file is re-serialized as 2-space JSON; the structural guard re-parses and
 * confirms the exact set of translatable paths is unchanged.
 */
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
    const enMap = new Map<string, string>();
    collect(JSON.parse(enContent) as Json, "", enMap);

    const cnMap = new Map<string, string>();
    if (cnContent) {
      try {
        collect(JSON.parse(cnContent) as Json, "", cnMap);
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
      root = JSON.parse(enContent) as Json;
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

    let applied = 0;
    for (const [key, ru] of translations) {
      if (!TRANSLATABLE.has(lastSegment(key))) continue;
      const current = before.get(key);
      if (current === undefined || current === ru) continue;
      if (setAtPath(root, key, ru)) applied++;
    }

    // Match the original's trailing newline (the game files have none) so an
    // identity apply is byte-exact and untranslated files stay untouched.
    const trailing = enContent.endsWith("\n") ? "\n" : "";
    const content = JSON.stringify(root, null, 2) + trailing;

    // Structural guard: the set of translatable paths must be identical.
    const after = new Map<string, string>();
    collect(JSON.parse(content) as Json, "", after);
    let guardOk = after.size === before.size;
    let guardError: string | undefined;
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

    return { content, applied, unsafe: 0, unsafeKeys: [], guardOk, guardError };
  },
};
