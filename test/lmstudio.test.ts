import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanOutput, mapPool } from "../src/engine/lmstudio.js";

test("cleanOutput strips <think> blocks", () => {
  assert.equal(cleanOutput("<think>reasoning here</think>Привет"), "Привет");
  assert.equal(cleanOutput("<think>\nmulti\nline\n</think>\n  Текст  "), "Текст");
});

test("cleanOutput removes a single pair of wrapping quotes", () => {
  assert.equal(cleanOutput('"Железное кольцо"'), "Железное кольцо");
  assert.equal(cleanOutput("«Текст»"), "Текст");
  assert.equal(cleanOutput("Без кавычек"), "Без кавычек");
});

test("cleanOutput preserves placeholder tokens", () => {
  assert.equal(cleanOutput("Наносит ⟦0⟧ урона"), "Наносит ⟦0⟧ урона");
});

test("mapPool preserves order with bounded concurrency", async () => {
  const items = [1, 2, 3, 4, 5];
  const out = await mapPool(items, 2, (n) => Promise.resolve(n * 10));
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test("mapPool runs at most `concurrency` tasks at once", async () => {
  let active = 0;
  let peak = 0;
  await mapPool(
    Array.from({ length: 10 }, (_, i) => i),
    3,
    async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return 0;
    },
  );
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded 3`);
});
