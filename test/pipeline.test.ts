import assert from "node:assert/strict";
import { test } from "node:test";

import { MockEngine } from "../src/engine/mock.js";
import type { TranslationEngine, TranslationRequest } from "../src/engine/types.js";
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

test("CN reference is threaded through to the engine", async () => {
  const requests: TranslationRequest[] = [];
  const recorder: TranslationEngine = {
    id: "recorder",
    checkpointSize: 100,
    translate(reqs) {
      requests.push(...reqs);
      return Promise.resolve(reqs.map((r) => `ru:${r.text}`));
    },
  };
  await translateFile(SAMPLE, recorder, { dryRun: true });
  assert.ok(requests.length > 0);
  // Loong has CN references, so at least one request carries one.
  assert.ok(
    requests.some((r) => typeof r.reference === "string" && r.reference.length > 0),
    "expected at least one request with a CN reference",
  );
});

test("progress is cumulative across checkpoints (does not reset per chunk)", async () => {
  const seen: number[] = [];
  const engine: TranslationEngine = {
    id: "cp",
    checkpointSize: 1, // one unit per checkpoint -> many chunks
    translate: (reqs, onProgress) => {
      reqs.forEach((_, i) => onProgress?.(i + 1));
      return Promise.resolve(reqs.map((r) => `ru:${r.text}`));
    },
  };
  await translateFile(SAMPLE, engine, { dryRun: true, onProgress: (n) => seen.push(n) });
  assert.ok(seen.length > 1, "expected multiple checkpoints");
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i]! > seen[i - 1]!, `progress must increase, got ${seen.join(",")}`);
  }
});

test("a markup-mangling engine flags units as failed (never writes corrupt output)", async () => {
  const breaker: TranslationEngine = {
    id: "breaker",
    checkpointSize: 5,
    translate: (reqs) => Promise.resolve(reqs.map(() => "BROKEN")), // drops all sentinels
  };
  const stats = await translateFile("BodyPart_language.txt", breaker, { dryRun: true });
  assert.ok(stats.failed > 0, "expected markup units to fail restore validation");
  assert.equal(stats.failures.length, stats.failed);
});
