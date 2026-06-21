/**
 * Pick the right {@link FormatAdapter} for a source file (relative path).
 */
import { isMultilineValueFile } from "../config/known-issues.js";
import { isEventFile } from "../config/sources.js";
import type { FormatAdapter } from "./adapter.js";
import { anchoredTxtAdapter } from "./anchored-txt.js";
import { eventLanguagesAdapter } from "./event-languages.js";
import { jsonTipAdapter } from "./json-tip.js";
import { pairedTxtAdapter } from "./paired-txt-adapter.js";
import { tsvAdapter } from "./tsv.js";

export function adapterFor(file: string): FormatAdapter {
  const posix = file.replace(/\\/g, "/");
  const base = posix.split("/").pop() ?? posix;
  if (isEventFile(posix)) return eventLanguagesAdapter;
  if (posix.endsWith(".tsv")) return tsvAdapter;
  if (posix.endsWith(".json")) return jsonTipAdapter;
  if (isMultilineValueFile(base)) return anchoredTxtAdapter;
  return pairedTxtAdapter;
}
