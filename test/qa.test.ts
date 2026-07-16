import assert from "node:assert/strict";
import { test } from "node:test";

import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../src/model/tm.js";
import { validateBilingual, validateTm } from "../src/validate/qa.js";

function u(en: string, ru: string | null): TmUnit {
  return { en, cn: null, ru, status: "machine", srcHash: "x", engine: "mock", updatedAt: null };
}

function tm(units: Record<string, TmUnit>): TmFile {
  return { schemaVersion: TM_SCHEMA_VERSION, file: "Demo.txt", glossaryVersion: 0, units };
}

function kinds(file: TmFile): string[] {
  return validateTm(file)
    .map((i) => i.kind)
    .sort();
}

test("clean translation produces no issues", () => {
  assert.deepEqual(validateTm(tm({ A: u("Deals {0} damage", "Наносит {0} урона") })), []);
});

test("detects markup mismatch", () => {
  assert.deepEqual(kinds(tm({ A: u("Deals {0} damage <NL>", "Наносит урона") })), [
    "markup-mismatch",
  ]);
});

test("detects mangled \\u escape (dropped hex digit)", () => {
  // EN has <…> (rendered < >); RU dropped a digit: > -> "\u003 ".
  const en = "\\u003ccolor=#x\\u003eSpoiler\\u003c/color\\u003e";
  const ru = "\\u003ccolor=#x\\u003 Спойлер\\u003c/color\\u003e";
  assert.deepEqual(kinds(tm({ A: u(en, ru) })), ["escape-mismatch"]);
});

test("detects mangled \\n escape (dropped n, bare backslash)", () => {
  const en = "Health.\\nInner Breath Chaos generates marks.";
  const ru = "Здоровью.\\Хаос дыхания генерирует метки."; // \n lost its n
  assert.deepEqual(kinds(tm({ A: u(en, ru) })), ["escape-mismatch"]);
});

test("intact escapes (\\u and \\n) produce no issue", () => {
  const en = "\\u003ccolor=#x\\u003eA\\u003c/color\\u003e\\nB";
  const ru = "\\u003ccolor=#x\\u003eА\\u003c/color\\u003e\\nБ";
  assert.deepEqual(validateTm(tm({ A: u(en, ru) })), []);
});

test("a legitimately dropped comma escape is not flagged (noise)", () => {
  // , is just a comma; translations alter punctuation freely.
  assert.deepEqual(validateTm(tm({ A: u("a\\u002cb", "а и б") })), []);
});

test("does not flag escapes already broken in the EN source", () => {
  // The game's own EN ships a pre-broken escape ("time? \I was"); a translation
  // that mirrors it is not at fault.
  const en = "Why now? \\I was alone.\\nYou left.";
  const ru = "Почему сейчас? \\Я был один.\\nТы ушёл.";
  assert.deepEqual(validateTm(tm({ A: u(en, ru) })), []);
});

test("flags a NEW mangle even when EN already has one", () => {
  const en = "Why? \\I was alone.\\nOk."; // 1 pre-broken
  const ru = "Почему? \\Я был один.\\Ещё одна.Ok."; // mirrors 1, adds another
  assert.ok(kinds(tm({ A: u(en, ru) })).includes("escape-mismatch"));
});

test("detects a cleanly dropped \\n line-break (no stray backslash)", () => {
  const issues = kinds(tm({ A: u("First line.\\nSecond line.", "Первая строка. Вторая строка.") }));
  assert.ok(issues.includes("escape-mismatch"));
});

test("detects empty output and newline hazard", () => {
  const issues = kinds(tm({ A: u("Hello world", ""), B: u("Hi there", "Привет\nмир") }));
  assert.ok(issues.includes("empty-output"));
  assert.ok(issues.includes("newline-hazard"));
});

test("real newlines matching the EN count are not a hazard", () => {
  assert.deepEqual(validateTm(tm({ A: u("Hello\nworld", "Привет\nмир") })), []);
});

test("flags a real newline dropped by the translation", () => {
  assert.deepEqual(kinds(tm({ A: u("Hello\nworld", "Привет мир") })), ["newline-hazard"]);
});

test('detects a changed \\t / \\" escape count', () => {
  assert.deepEqual(kinds(tm({ A: u("Col A\\tCol B", "Столбец А Столбец Б") })), [
    "escape-mismatch",
  ]);
  assert.deepEqual(kinds(tm({ A: u('Say \\"hi\\" now', "Скажи привет") })), ["escape-mismatch"]);
});

test('matching \\t and \\" escape counts produce no issue', () => {
  assert.deepEqual(validateTm(tm({ A: u('A\\tB \\"quote\\"', 'А\\tБ \\"цитата\\"') })), []);
});

test("detects untranslated (RU equals EN)", () => {
  assert.deepEqual(kinds(tm({ A: u("Iron Ring", "Iron Ring") })), ["untranslated"]);
});

test("detects length anomaly (RU too short)", () => {
  assert.deepEqual(kinds(tm({ A: u("A reasonably long sentence here", "X") })), ["length-anomaly"]);
});

test("detects length bloat (RU much longer than EN)", () => {
  // ~2.5× the English: risks being clipped by an English-sized UI box.
  assert.deepEqual(
    kinds(
      tm({ A: u("Attack the foe", "Стремительно и беспощадно атакуйте своего врага немедленно") }),
    ),
    ["length-bloat"],
  );
  // Normal Russian expansion (~1.3×) is not flagged.
  assert.deepEqual(kinds(tm({ A: u("Attack the enemy now", "Атакуйте врага сейчас") })), []);
});

test("skips length anomaly when EN field is Chinese", () => {
  // Untranslated Chinese in the en field: dense hanzi vs a full RU sentence
  // would trip the ratio if we compared lengths.
  const ru = "Достигнув вершины горы, увидишь, как малы все горы вокруг.";
  assert.deepEqual(kinds(tm({ A: u("会当凌绝顶，一览众山小。", ru) })), []);
});

test("pending units (ru=null) are ignored", () => {
  assert.deepEqual(validateTm(tm({ A: u("Hello world", null) })), []);
});

test("validateBilingual flags EN<->CN markup divergence, skips missing CN", () => {
  const issues = validateBilingual("Demo.txt", [
    { key: "A", en: "Deals {0} damage", cn: "造成 {0} 伤害" }, // markup matches -> ok
    { key: "B", en: "Deals {0} damage", cn: "造成伤害" }, // EN has {0}, CN none -> divergence
    { key: "C", en: "plain", cn: null }, // no CN -> skipped
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.kind, "cn-divergence");
  assert.equal(issues[0]!.key, "B");
});
