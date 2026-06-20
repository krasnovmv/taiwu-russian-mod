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

test("YandexEngine.fromEnv returns null without credentials", () => {
  const saved = {
    iam: process.env.TAIWU_YANDEX_IAM_TOKEN,
    folder: process.env.TAIWU_YANDEX_FOLDER_ID,
  };
  delete process.env.TAIWU_YANDEX_IAM_TOKEN;
  delete process.env.TAIWU_YANDEX_FOLDER_ID;
  try {
    assert.equal(YandexEngine.fromEnv(), null);
  } finally {
    if (saved.iam !== undefined) process.env.TAIWU_YANDEX_IAM_TOKEN = saved.iam;
    if (saved.folder !== undefined) process.env.TAIWU_YANDEX_FOLDER_ID = saved.folder;
  }
});
