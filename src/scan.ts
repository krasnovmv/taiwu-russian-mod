/**
 * Discovery of source language files.
 */
import { readdir } from "node:fs/promises";

import { languageDir } from "./config/paths.js";
import { isMultilineValueFile } from "./config/known-issues.js";

/** All `.txt` files in the EN language directory, sorted. */
export async function listTxtFiles(): Promise<string[]> {
  const entries = await readdir(languageDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".txt"))
    .map((e) => e.name)
    .sort();
}

/** `.txt` files safe for strict-alternation translation (excludes quarantine). */
export async function listTranslatableTxtFiles(): Promise<string[]> {
  return (await listTxtFiles()).filter((f) => !isMultilineValueFile(f));
}
