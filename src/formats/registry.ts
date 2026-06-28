/**
 * Pick the right {@link FormatAdapter} for a source file (relative path).
 */
import { isMultilineValueFile } from "../config/known-issues.js";
import { isEventFile, isOptionTipsFile } from "../config/sources.js";
import type { FormatAdapter } from "./adapter.js";
import { anchoredTxtAdapter } from "./anchored-txt.js";
import {
  encyclopediaContentAdapter,
  encyclopediaReferenceAdapter,
} from "./encyclopedia.js";
import { eventLanguagesAdapter } from "./event-languages.js";
import { jsonTipAdapter } from "./json-tip.js";
import { optionTipsAdapter } from "./option-tips.js";
import { pairedTxtAdapter } from "./paired-txt-adapter.js";
import { tsvAdapter } from "./tsv.js";

export function adapterFor(file: string): FormatAdapter {
  const posix = file.replace(/\\/g, "/");
  const base = posix.split("/").pop() ?? posix;
  if (isOptionTipsFile(posix)) return optionTipsAdapter;
  if (isEventFile(posix)) return eventLanguagesAdapter;
  // The two encyclopedia INDEX tables mix display text with stable navigation
  // identifiers in fixed columns; they need the schema-aware adapter so the
  // anchors and cross-file links survive translation. Other .tsv are pure data.
  if (base === "EncyclopediaContent.tsv") return encyclopediaContentAdapter;
  if (base === "EncyclopediaReference.tsv") return encyclopediaReferenceAdapter;
  if (posix.endsWith(".tsv")) return tsvAdapter;
  if (posix.endsWith(".json")) return jsonTipAdapter;
  if (isMultilineValueFile(base)) return anchoredTxtAdapter;
  return pairedTxtAdapter;
}
