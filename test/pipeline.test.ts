import assert from "node:assert/strict";
import { test } from "node:test";

import { MockEngine } from "../src/engine/mock.js";
import { translateFile } from "../src/translate/pipeline.js";

/**
 * End-to-end pipeline on a real small file with the offline mock engine and
 * dry-run (no TM written). Proves alignment → mask → translate → restore →
 * validate works on real data without any markup-validation failures.
 */
const SAMPLE = "Loong_language.txt";

test(`translateFile runs clean on ${SAMPLE} (mock, dry-run)`, async () => {
  const stats = await translateFile(SAMPLE, new MockEngine(), { dryRun: true });
  assert.ok(stats.total > 0);
  assert.equal(stats.failed, 0, JSON.stringify(stats.failures));
  assert.ok(stats.translated > 0, "expected some units translated");
  assert.equal(stats.translated + stats.skipped + stats.failed, stats.total);
});

test("translateFile respects --limit", async () => {
  const stats = await translateFile(SAMPLE, new MockEngine(), { dryRun: true, limit: 2 });
  assert.ok(stats.translated <= 2);
});
