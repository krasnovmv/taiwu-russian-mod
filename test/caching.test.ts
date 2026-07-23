import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CachingEngine, usableOutput } from "../src/engine/caching.js";
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

test("invalid outputs are not cached (re-translated on the next run)", async () => {
  const file = await cacheFile();
  let calls = 0;
  const broken: TranslationEngine = {
    id: "x",
    checkpointSize: 50,
    translate(reqs: TranslationRequest[]) {
      calls += reqs.length;
      return Promise.resolve(reqs.map(() => "BROKEN"));
    },
  };
  // Reject any output containing "BROKEN".
  const eng = new CachingEngine(broken, file, new Map(), (_i, o) => !o.includes("BROKEN"));
  assert.deepEqual(await eng.translate([{ text: "a" }]), ["BROKEN"]); // returned anyway
  await eng.translate([{ text: "a" }]); // same text: cache miss -> inner runs again
  assert.equal(calls, 2, "invalid output must not be cached");
});

test("valid outputs are still cached", async () => {
  const file = await cacheFile();
  const c = counter();
  const eng = new CachingEngine(c.engine, file, new Map(), (_i, o) => !o.includes("BROKEN"));
  await eng.translate([{ text: "a" }]);
  await eng.translate([{ text: "a" }]);
  assert.deepEqual(c.seen, ["a"]); // cached after the first call
});

test("an echoed-back Chinese entry is dropped on load and re-translated", async () => {
  const file = await cacheFile();
  // What an older run stored when a wholly-Chinese source was sent as English:
  // Yandex handed the input straight back. The pipeline rejects hanzi in RU, so
  // serving this entry would keep the unit failing forever.
  await writeFile(
    file,
    [
      JSON.stringify({ k: "人物信息", v: "人物信息" }),
      JSON.stringify({ k: "b", v: "ru:b" }),
      "",
    ].join("\n"),
    "utf8",
  );

  const c = counter();
  const eng = new CachingEngine(c.engine, file, new Map(), (_i, o) => usableOutput(o));
  assert.deepEqual(await eng.translate([{ text: "人物信息" }, { text: "b" }]), [
    "ru:人物信息",
    "ru:b",
  ]);
  assert.deepEqual(c.seen, ["人物信息"], "the poisoned entry must miss, not be served");

  // The drop is persisted: the rewrite leaves the clean entry only. The fresh
  // output still carries hanzi (this inner engine echoes), so it isn't stored
  // either — a later run gets to try again.
  const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l !== "");
  assert.deepEqual(
    lines.map((l) => JSON.parse(l) as unknown),
    [{ k: "b", v: "ru:b" }],
  );
});

test("usableOutput ignores hanzi inside masked markup, not in the text", () => {
  assert.equal(usableOutput("Кулак"), true);
  assert.equal(usableOutput("人物信息"), false);
  assert.equal(usableOutput("Сила <color=#天>удара</color>"), true);
});

test("usableOutput rejects a blank translation (refusal reduced to nothing)", () => {
  assert.equal(usableOutput(""), false);
  assert.equal(usableOutput("  \n "), false);
});

test("an empty cached entry is dropped on load and re-translated", async () => {
  const file = await cacheFile();
  // What an older run stored when a refusal was cleaned down to nothing: served
  // as a hit, it would keep the unit empty forever, immune to a live re-run.
  await writeFile(
    file,
    [JSON.stringify({ k: "a", v: "" }), JSON.stringify({ k: "b", v: "ru:b" }), ""].join("\n"),
    "utf8",
  );

  const c = counter();
  const eng = new CachingEngine(c.engine, file, new Map(), (_i, o) => usableOutput(o));
  assert.deepEqual(await eng.translate([{ text: "a" }, { text: "b" }]), ["ru:a", "ru:b"]);
  assert.deepEqual(c.seen, ["a"], "the empty entry must miss, not be served");

  // The drop is persisted; the fresh (valid) output takes the key's place.
  const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l !== "");
  assert.deepEqual(
    lines.map((l) => JSON.parse(l) as unknown),
    [
      { k: "b", v: "ru:b" },
      { k: "a", v: "ru:a" },
    ],
  );
});

test("duplicate cache lines are compacted on load (one line per key, last wins)", async () => {
  const file = await cacheFile();
  // An append-only log with a repeated key: the later value must win.
  await writeFile(
    file,
    [
      JSON.stringify({ k: "a", v: "old-a" }),
      JSON.stringify({ k: "b", v: "ru:b" }),
      JSON.stringify({ k: "a", v: "new-a" }),
      "",
    ].join("\n"),
    "utf8",
  );

  const c = counter();
  const eng = new CachingEngine(c.engine, file);
  // Both keys served from cache; "a" resolves to the last-written value.
  assert.deepEqual(await eng.translate([{ text: "a" }, { text: "b" }]), ["new-a", "ru:b"]);
  assert.deepEqual(c.seen, []); // nothing re-translated

  // File is rewritten: two unique lines, no duplicate "a".
  const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((l) => JSON.parse(l)),
    [
      { k: "a", v: "new-a" },
      { k: "b", v: "ru:b" },
    ],
  );
});

test("a duplicate-free cache is left untouched on load", async () => {
  const file = await cacheFile();
  const original = [JSON.stringify({ k: "a", v: "ru:a" }), ""].join("\n");
  await writeFile(file, original, "utf8");

  const c = counter();
  await new CachingEngine(c.engine, file).translate([{ text: "a" }]);
  assert.equal(await readFile(file, "utf8"), original); // byte-for-byte unchanged
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
