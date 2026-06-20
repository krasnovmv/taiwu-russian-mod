import assert from "node:assert/strict";
import { test } from "node:test";

import { folderIdProvider, iamTokenProvider } from "../src/engine/yandex-creds.js";
import { ycFolderId, ycIamToken } from "../src/engine/yc.js";
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

test("YandexEngine.fromEnv always builds an engine (creds resolved lazily)", () => {
  const engine = YandexEngine.fromEnv();
  assert.equal(engine.id, "yandex");
});

async function withEnv(
  vars: Record<string, string | undefined>,
  body: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await body();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("credential providers use env when set, else fall back to yc", async () => {
  await withEnv(
    { TAIWU_YANDEX_IAM_TOKEN: "env-token", TAIWU_YANDEX_FOLDER_ID: "env-folder" },
    async () => {
      assert.equal(await iamTokenProvider()(), "env-token");
      assert.equal(await folderIdProvider()(), "env-folder");
    },
  );
  await withEnv({ TAIWU_YANDEX_IAM_TOKEN: undefined, TAIWU_YANDEX_FOLDER_ID: undefined }, () => {
    // Without env vars, the provider IS the yc resolver (not invoked here).
    assert.equal(iamTokenProvider(), ycIamToken);
    assert.equal(folderIdProvider(), ycFolderId);
    return Promise.resolve();
  });
});
