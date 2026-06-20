import assert from "node:assert/strict";
import { test } from "node:test";

import { alignFile } from "../src/align/bilingual.js";

/**
 * Integration check against the real game files: a small clean file must align
 * EN to CN by key, with CN references present and value indices recoverable.
 */
const SAMPLE = "Loong_language.txt";

test(`alignFile pairs EN with CN for ${SAMPLE}`, async () => {
  const aligned = await alignFile(SAMPLE);
  assert.ok(aligned.units.length > 0, "expected at least one unit");

  const withCn = aligned.units.filter((u) => u.cn !== null);
  assert.ok(withCn.length > 0, "expected CN references to be joined");

  for (const u of aligned.units) {
    assert.equal(typeof u.key, "string");
    assert.ok(u.key.length > 0);
    assert.ok(Number.isInteger(u.enValueIndex) && u.enValueIndex >= 1);
  }
});

test("alignFile reports onlyEn/onlyCn as arrays", async () => {
  const aligned = await alignFile(SAMPLE);
  assert.ok(Array.isArray(aligned.onlyEn));
  assert.ok(Array.isArray(aligned.onlyCn));
});
