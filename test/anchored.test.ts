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

test("CN-only keys are extracted as zh units and appended on apply", () => {
  const cn = CN.replace(/\n\n$/, "\nDesc_2\n新\n\n");
  const { units } = anchoredTxtAdapter.extract(EN, cn);
  const extra = units.find((u) => u.key === "Desc_2")!;
  assert.deepEqual(extra, { key: "Desc_2", en: "新", cn: null, srcLang: "zh" });
  const map = new Map(units.map((u) => [u.key, u.en]));
  map.set("Desc_2", "Новое");
  const out = anchoredTxtAdapter.apply(EN, map);
  assert.equal(out.guardOk, true);
  assert.equal(out.applied, 1);
  assert.equal(out.content, "Desc_0\nLine one.\nLine two.\nDesc_1\nSingle.\nDesc_2\nНовое\n\n");
});
