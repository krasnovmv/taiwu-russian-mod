import assert from "node:assert/strict";
import { test } from "node:test";

import { MockEngine } from "../src/engine/mock.js";
import type { TranslationEngine, TranslationRequest } from "../src/engine/types.js";
import type { TmUnit } from "../src/model/tm.js";
import { needsTranslation, planFile, translateFile } from "../src/translate/pipeline.js";

/**
 * End-to-end pipeline on a real small file with the offline mock engine and
 * dry-run (no TM written). Proves alignment → mask → translate → restore →
 * validate works on real data without any markup-validation failures.
 */
const SAMPLE = "Loong_language.txt";

test(`translateFile runs clean on ${SAMPLE} (mock, dry-run)`, async () => {
  const stats = await translateFile(SAMPLE, new MockEngine(), { dryRun: true, maxLen: Infinity });
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
  await translateFile(SAMPLE, recorder, { dryRun: true, maxLen: Infinity });
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
  await translateFile(SAMPLE, engine, {
    dryRun: true,
    maxLen: Infinity,
    onProgress: (n) => seen.push(n),
  });
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
  const stats = await translateFile("BodyPart_language.txt", breaker, {
    dryRun: true,
    maxLen: Infinity,
  });
  assert.ok(stats.failed > 0, "expected markup units to fail restore validation");
  assert.equal(stats.failures.length, stats.failed);
});

test("length window restricts which units are translated", async () => {
  const shortOnly = await translateFile(SAMPLE, new MockEngine(), { dryRun: true, maxLen: 5 });
  const longOnly = await translateFile(SAMPLE, new MockEngine(), { dryRun: true, minLen: 6 });
  const all = await translateFile(SAMPLE, new MockEngine(), { dryRun: true });
  assert.ok(shortOnly.translated < all.translated, "a tight max window translates fewer");
  assert.ok(longOnly.translated <= all.translated);
  // The two disjoint windows together cover exactly the whole file's translatable set.
  assert.equal(shortOnly.translated + longOnly.translated, all.translated);
});

test("planFile matches the units actually sent to the engine (global bar total)", async () => {
  for (const opts of [{}, { maxLen: 15 }, { minLen: 16 }]) {
    const planned = await planFile(SAMPLE, new MockEngine().id, opts);
    let onStart = -1;
    await translateFile(SAMPLE, new MockEngine(), {
      ...opts,
      dryRun: true,
      onStart: (t) => (onStart = t),
    });
    assert.equal(planned, onStart, `plan must equal onStart for ${JSON.stringify(opts)}`);
  }
});

test("needsTranslation re-translates on engine mismatch (routing/overwrite)", () => {
  const u = (over: Partial<TmUnit>): TmUnit => ({
    en: "x",
    cn: null,
    ru: "ру",
    status: "machine",
    srcHash: "h",
    engine: "yandex",
    updatedAt: null,
    ...over,
  });
  assert.equal(needsTranslation(undefined, "h", "yandex"), true); // new
  assert.equal(needsTranslation(u({ ru: null }), "h", "yandex"), true); // no RU
  assert.equal(needsTranslation(u({}), "h", "yandex"), false); // same engine + hash
  assert.equal(needsTranslation(u({}), "h", "lmstudio"), true); // engine changed -> redo
  assert.equal(needsTranslation(u({}), "h2", "yandex"), true); // source drifted -> redo
  assert.equal(needsTranslation(u({ status: "reviewed" }), "h2", "lmstudio"), false); // human kept
});
