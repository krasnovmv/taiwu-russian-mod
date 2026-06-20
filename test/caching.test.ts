import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CachingEngine } from "../src/engine/caching.js";
import type {
  ProgressCallback,
  TranslationEngine,
  TranslationRequest,
} from "../src/engine/types.js";

/** Inner engine that records the texts it was asked to translate. */
function counter(): { engine: TranslationEngine; seen: string[] } {
  const seen: string[] = [];
  const engine: TranslationEngine = {
    id: "inner",
    checkpointSize: 50,
    translate(reqs: TranslationRequest[], onProgress?: ProgressCallback) {
      reqs.forEach((r, i) => {
        seen.push(r.text);
        onProgress?.(i + 1);
      });
      return Promise.resolve(reqs.map((r) => `ru:${r.text}`));
    },
  };
  return { engine, seen };
}

async function cacheFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "taiwu-cache-"));
  return path.join(dir, "engine.jsonl");
}

test("id and checkpointSize delegate to the inner engine", () => {
  const c = counter();
  const eng = new CachingEngine(c.engine, "unused");
  assert.equal(eng.id, "inner");
  assert.equal(eng.checkpointSize, 50);
});

test("misses hit the inner engine; repeats are served from cache", async () => {
  const file = await cacheFile();
  const c = counter();
  const eng = new CachingEngine(c.engine, file);

  assert.deepEqual(await eng.translate([{ text: "a" }, { text: "b" }]), ["ru:a", "ru:b"]);
  assert.deepEqual(c.seen, ["a", "b"]);

  // "a" is cached now; only "c" is new.
  assert.deepEqual(await eng.translate([{ text: "a" }, { text: "c" }]), ["ru:a", "ru:c"]);
  assert.deepEqual(c.seen, ["a", "b", "c"]);
});

test("cache persists to disk and survives a fresh engine instance", async () => {
  const file = await cacheFile();
  const first = counter();
  await new CachingEngine(first.engine, file).translate([{ text: "x" }]);
  assert.deepEqual(first.seen, ["x"]);

  // New instance, same file: served from disk without touching the inner engine.
  const second = counter();
  const reloaded = new CachingEngine(second.engine, file);
  assert.deepEqual(await reloaded.translate([{ text: "x" }]), ["ru:x"]);
  assert.deepEqual(second.seen, []);
});

test("glossary-free texts keep key === text (cache reused across glossary edits)", async () => {
  const file = await cacheFile();
  const c = counter();
  // Same text, different glossaries; the text has no glossary term either way.
  await new CachingEngine(c.engine, file, new Map([["qi", "ци"]])).translate([{ text: "plain" }]);
  const reloaded = new CachingEngine(c.engine, file, new Map([["qi", "чи"]]));
  assert.deepEqual(await reloaded.translate([{ text: "plain" }]), ["ru:plain"]);
  assert.deepEqual(c.seen, ["plain"]); // second call served from cache, not re-run
});

test("editing a term re-translates only texts that contain it", async () => {
  const file = await cacheFile();
  const c = counter();
  await new CachingEngine(c.engine, file, new Map([["qi", "ци"]])).translate([{ text: "your Qi" }]);
  assert.deepEqual(c.seen, ["your Qi"]);

  // Changing Qi's RU value changes the signature → cache miss → re-translate.
  const edited = new CachingEngine(c.engine, file, new Map([["qi", "чи"]]));
  await edited.translate([{ text: "your Qi" }]);
  assert.deepEqual(c.seen, ["your Qi", "your Qi"]);

  // Re-running with the same (edited) glossary is now a cache hit.
  await edited.translate([{ text: "your Qi" }]);
  assert.deepEqual(c.seen, ["your Qi", "your Qi"]);
});

test("progress reaches the full request count (hits + misses)", async () => {
  const file = await cacheFile();
  const c = counter();
  const eng = new CachingEngine(c.engine, file);
  await eng.translate([{ text: "seed" }]); // warm the cache

  const seen: number[] = [];
  await eng.translate([{ text: "seed" }, { text: "new" }], (n) => seen.push(n));
  assert.equal(Math.max(...seen), 2); // both units reported done
});
