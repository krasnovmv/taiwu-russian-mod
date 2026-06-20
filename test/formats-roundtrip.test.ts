import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { languageCnDir, languageDir } from "../src/config/paths.js";
import type { FormatAdapter } from "../src/formats/adapter.js";
import { adapterFor } from "../src/formats/registry.js";
import { listSourceFiles } from "../src/scan.js";

/**
 * Safety net for the non-txt formats: for every real `.tsv`, `.json` and
 * anchored `.txt`, extracting and then applying an *identity* translation
 * (key → original EN) must reproduce the file byte-for-byte. This proves apply
 * never corrupts untranslated content.
 */
async function readIf(dir: string, file: string): Promise<string | null> {
  try {
    return await readFile(path.join(dir, file), "utf8");
  } catch {
    return null;
  }
}

const files = await listSourceFiles();

for (const file of files) {
  const adapter: FormatAdapter = adapterFor(file);
  if (adapter.id === "paired-txt") continue; // covered by roundtrip.test.ts

  test(`identity apply byte-exact (${adapter.id}): ${file}`, async () => {
    const en = await readFile(path.join(languageDir, file), "utf8");
    const cn = await readIf(languageCnDir, file);
    const { units } = adapter.extract(en, cn);
    const identity = new Map(units.map((u) => [u.key, u.en]));
    const out = adapter.apply(en, identity);
    assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
    assert.equal(out.content, en);
  });
}
