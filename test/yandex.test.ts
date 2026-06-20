import assert from "node:assert/strict";
import { test } from "node:test";

import { YandexEngine, batchByChars } from "../src/engine/yandex.js";

test("batchByChars respects the character budget", () => {
  const texts = ["aaaa", "bbbb", "cccc"]; // 4 chars each
  const batches = batchByChars(texts, 8, 100);
  assert.deepEqual(batches, [["aaaa", "bbbb"], ["cccc"]]);
});

test("batchByChars respects the max-texts cap", () => {
  const texts = ["a", "b", "c", "d", "e"];
  const batches = batchByChars(texts, 1000, 2);
  assert.deepEqual(batches, [["a", "b"], ["c", "d"], ["e"]]);
});

test("a single oversized text is its own batch (never dropped)", () => {
  const texts = ["x".repeat(50), "y"];
  const batches = batchByChars(texts, 10, 100);
  assert.deepEqual(batches, [["x".repeat(50)], ["y"]]);
});

test("YandexEngine.fromEnv builds an engine (yc creds resolved lazily)", () => {
  const engine = YandexEngine.fromEnv();
  assert.equal(engine.id, "yandex");
});

test("credentials are resolved lazily, not at construction", () => {
  let tokenCalls = 0;
  let folderCalls = 0;
  const engine = new YandexEngine({
    getIamToken: () => {
      tokenCalls++;
      return Promise.resolve("t");
    },
    getFolderId: () => {
      folderCalls++;
      return Promise.resolve("f");
    },
  });
  assert.equal(tokenCalls, 0); // constructing must not resolve credentials
  assert.equal(folderCalls, 0);
  assert.equal(engine.id, "yandex");
});
