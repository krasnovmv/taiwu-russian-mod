import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { resolveSource } from "../src/config/sources.js";
import type { FormatAdapter } from "../src/formats/adapter.js";
import { adapterFor } from "../src/formats/registry.js";
import { listEventFiles, listSourceFiles } from "../src/scan.js";

/**
 * Safety net for the non-txt formats: for every real `.tsv`, `.json`, anchored
 * `.txt` and `Event_Languages` quest file, extracting and then applying an
 * *identity* translation (key → original EN) must reproduce the file
 * byte-for-byte. This proves apply never corrupts untranslated content. The
 * EN/CN paths come from {@link resolveSource}, so every source family is read
 * from its real on-disk layout.
 */
async function readIf(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

// Always cover the event corpus here, even though it is gated out of the
// pipeline by default (TAIWU_EVENTS) — the round-trip safety net should not
// depend on whether quest translation is currently enabled.
const files = [...new Set([...(await listSourceFiles()), ...(await listEventFiles())])];

for (const file of files) {
  const adapter: FormatAdapter = adapterFor(file);
  if (adapter.id === "paired-txt") continue; // covered by roundtrip.test.ts

  test(`identity apply byte-exact (${adapter.id}): ${file}`, async () => {
    const { en: enPath, cn: cnPath } = resolveSource(file);
    const en = await readFile(enPath, "utf8");
    const cn = await readIf(cnPath);
    const { units } = adapter.extract(en, cn);
    const identity = new Map(units.map((u) => [u.key, u.en]));
    const out = adapter.apply(en, identity);
    assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
    assert.equal(out.content, en);
  });
}
