import assert from "node:assert/strict";
import { test } from "node:test";

import { mask, restore } from "../src/engine/protect.js";

/** Simulate an engine that preserves sentinels (good engine). */
function goodEngine(masked: string): string {
  return `ru:${masked}`;
}

test("tags and placeholders are masked and restored verbatim", () => {
  const src = "Deals {0} damage <color=#brightred>now</color><NL>see <Character key=X str=Y/>!";
  const m = mask(src);
  // No real tag/placeholder remains once the sentinels are stripped.
  assert.ok(!/[<>{}]/.test(m.masked.replace(/<m\d+><\/m\d+>/g, "")));
  const r = restore(goodEngine(m.masked), m);
  assert.ok(r.ok, r.error ?? "restore failed");
  // Every original span is present again.
  for (const span of [
    "{0}",
    "<color=#brightred>",
    "</color>",
    "<NL>",
    "<Character key=X str=Y/>",
  ]) {
    assert.ok(r.text.includes(span), `missing ${span}`);
  }
});

test("leading/trailing whitespace is preserved exactly", () => {
  const src = "  Click the middle  ";
  const m = mask(src);
  const r = restore(goodEngine(m.masked), m);
  assert.ok(r.ok);
  assert.ok(r.text.startsWith("  "));
  assert.ok(r.text.endsWith("  "));
});

test("tag-only / placeholder-only values are marked not translatable", () => {
  assert.equal(mask("{0}").translatable, false);
  assert.equal(mask("<NL>").translatable, false);
  assert.equal(mask("<color=#x>{0}</color>").translatable, false);
  assert.equal(mask("Hello {0}").translatable, true);
});

test("restore fails (no throw) when a sentinel is dropped", () => {
  const m = mask("Deals {0} damage");
  const r = restore("ru: damage", m); // dropped <m0></m0>
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /sentinel/);
});

test("restore fails when a sentinel is duplicated", () => {
  const m = mask("{0} and {1}");
  const r = restore("<m0></m0> <m0></m0> <m1></m1>", m);
  assert.equal(r.ok, false);
});

test("restore rejects a hallucinated leftover sentinel (no markup in source)", () => {
  const m = mask("Monarch Seal"); // no markup -> no sentinels expected
  const r = restore("Печать «Ушуйинь» <m1>", m); // LLM invented a stray <m1>
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /leftover sentinel/);
});

test("glossary terms are NOT masked — they reach the engine verbatim", () => {
  // Glossary is applied by the engine now, not by masking; mask leaves words alone.
  const m = mask("Restore your Qi now");
  assert.ok(m.masked.includes("Qi"), "term stays in the text for the engine to translate");
  assert.equal(m.tokens.length, 0);
});
