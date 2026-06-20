import assert from "node:assert/strict";
import { test } from "node:test";

import { anchoredTxtAdapter } from "../src/formats/anchored-txt.js";

// EN: Desc_0's value spans two physical lines (a real newline) — this is what
// breaks strict alternation. CN is clean and acts as the key oracle.
const EN = "Desc_0\nLine one.\nLine two.\nDesc_1\nSingle.\n\n";
const CN = "Desc_0\n句子一\nDesc_1\n单\n\n";

test("extract uses CN keys and recovers multi-line EN values", () => {
  const { units, warnings } = anchoredTxtAdapter.extract(EN, CN);
  assert.deepEqual(warnings, []);
  const byKey = new Map(units.map((u) => [u.key, u]));
  assert.equal(byKey.get("Desc_0")!.en, "Line one.\nLine two.");
  assert.equal(byKey.get("Desc_0")!.cn, "句子一");
  assert.equal(byKey.get("Desc_1")!.en, "Single.\n");
});

test("identity apply is byte-exact", () => {
  const { units } = anchoredTxtAdapter.extract(EN, CN);
  const out = anchoredTxtAdapter.apply(EN, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true);
  assert.equal(out.content, EN);
});

test("apply replaces a multi-line value", () => {
  const { units } = anchoredTxtAdapter.extract(EN, CN);
  const map = new Map(units.map((u) => [u.key, u.en]));
  map.set("Desc_0", "Одна строка.");
  const out = anchoredTxtAdapter.apply(EN, map);
  assert.equal(out.guardOk, true);
  assert.equal(out.applied, 1);
  assert.equal(out.content, "Desc_0\nОдна строка.\nDesc_1\nSingle.\n\n");
});

test("extract without CN oracle yields a warning, no units", () => {
  const { units, warnings } = anchoredTxtAdapter.extract(EN, null);
  assert.equal(units.length, 0);
  assert.ok(warnings.length > 0);
});
