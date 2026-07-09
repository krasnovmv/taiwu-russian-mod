import assert from "node:assert/strict";
import { test } from "node:test";

import JSON5 from "json5";

import {
  buildFile,
  diffGlossary,
  glossaryToCsv,
  parseCsv,
  parseSheet,
  type GlossaryValue,
} from "../src/glossary/sheet.js";

/** Index an array, asserting the element exists (keeps tsc's index checks happy). */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  assert.ok(v !== undefined, `expected an element at index ${i}`);
  return v;
}

// A small canonical glossary in the exact shape buildFile emits: `_comment`,
// then blank-separated sections, quoted `{ ru, feed }` objects, no trailing comma.
const CANONICAL = `{
  "_comment": "meta, kept as-is",

  "_section_01_cultivation": "Ци",
  "Qi": "Ци",
  "Phy. Penetration": { "ru": "Физ. урон", "feed": "Physical Penetration" },

  "_section_02_cities": "Города",
  "Dali": "Дали"
}
`;

test("export → import is a byte-identical round-trip", () => {
  const parsed: Record<string, GlossaryValue> = JSON5.parse(CANONICAL);
  const csv = glossaryToCsv(parsed);
  const rebuilt = buildFile(parsed, parseSheet(csv));
  assert.equal(rebuilt, CANONICAL);
});

test("parseSheet groups terms by the divider above them, in order", () => {
  const csv =
    "EN,RU,feed,comment\r\n" +
    ",,,Города\r\n" +
    "Dali,Дали,,\r\n" +
    "Luoyang,Лоян,,\r\n" +
    ",,,Секты\r\n" +
    "Shaolin,Шаолинь,,\r\n";
  const sheet = parseSheet(csv);
  assert.deepEqual(
    sheet.sections.map((s) => s.label),
    ["Города", "Секты"],
  );
  assert.deepEqual(
    at(sheet.sections, 0).terms.map((t) => t.en),
    ["Dali", "Luoyang"],
  );
  assert.equal(at(at(sheet.sections, 1).terms, 0).en, "Shaolin");
  assert.equal(sheet.preamble.length, 0);
});

test("a term above the first divider lands in the preamble", () => {
  const sheet = parseSheet("EN,RU,feed,comment\r\nOrphan,Сирота,,\r\n,,,Города\r\nDali,Дали,,\r\n");
  assert.deepEqual(
    sheet.preamble.map((t) => t.en),
    ["Orphan"],
  );
  assert.equal(at(at(sheet.sections, 0).terms, 0).en, "Dali");
});

test("blank rows are spacing, not section resets", () => {
  const csv = "EN,RU,feed,comment\r\n,,,Города\r\nDali,Дали,,\r\n,,,\r\nLuoyang,Лоян,,\r\n";
  const sheet = parseSheet(csv);
  assert.equal(sheet.sections.length, 1);
  assert.deepEqual(
    at(sheet.sections, 0).terms.map((t) => t.en),
    ["Dali", "Luoyang"],
  );
});

test("rows missing EN or RU are collected as invalid, not terms", () => {
  const sheet = parseSheet("EN,RU,feed,comment\r\n,,,Города\r\nDali,,,\r\nLuoyang,Лоян,,\r\n");
  assert.equal(at(sheet.sections, 0).terms.length, 1);
  assert.deepEqual(
    sheet.invalid.map((r) => r.en),
    ["Dali"],
  );
});

test("duplicate EN keeps the first and reports the rest", () => {
  const sheet = parseSheet("EN,RU,feed,comment\r\n,,,Города\r\nDali,Дали,,\r\ndali,Другой,,\r\n");
  assert.equal(at(sheet.sections, 0).terms.length, 1);
  assert.equal(at(at(sheet.sections, 0).terms, 0).ru, "Дали");
  assert.equal(sheet.dupes.length, 1);
});

test("import mirrors the sheet: order, insert, edit, delete", () => {
  const parsed: Record<string, GlossaryValue> = JSON5.parse(CANONICAL);
  // Reorder + insert in the cities section, edit Qi, drop Phy. Penetration.
  const csv =
    "EN,RU,feed,comment\r\n" +
    ",,,Ци\r\n" +
    "Qi,ЦИ-2,,\r\n" +
    ",,,Города\r\n" +
    "Kaifeng,Кайфэн,,\r\n" +
    "Dali,Дали,,\r\n";
  const out = buildFile(parsed, parseSheet(csv));
  const reparsed: Record<string, GlossaryValue> = JSON5.parse(out);
  assert.equal(reparsed["Qi"], "ЦИ-2"); // edited
  assert.equal(reparsed["Phy. Penetration"], undefined); // deleted
  // Kaifeng inserted before Dali, matching CSV order.
  const keys = Object.keys(reparsed).filter((k) => !k.startsWith("_"));
  assert.deepEqual(keys, ["Qi", "Kaifeng", "Dali"]);
  assert.equal(reparsed["_comment"], "meta, kept as-is"); // metadata preserved
});

test("a feed column round-trips as a { ru, feed } object", () => {
  const parsed: Record<string, GlossaryValue> = { _section_01_x: "X", A: "а" };
  const csv = "EN,RU,feed,comment\r\n,,,X\r\nPhy.,Физ,Physical,\r\n";
  const out = buildFile(parsed, parseSheet(csv));
  assert.match(out, /"Phy\.": \{ "ru": "Физ", "feed": "Physical" \}/);
});

test("a cs column round-trips as a { ru, cs } object", () => {
  const parsed: Record<string, GlossaryValue> = {
    _section_01_x: "X",
    Attack: { ru: "атака", cs: true },
    Sect: "секта",
  };
  const csv = glossaryToCsv(parsed);
  assert.match(csv, /Attack,атака,,true,/);
  assert.match(csv, /Sect,секта,,,/);
  const rebuilt = buildFile(parsed, parseSheet(csv));
  const reparsed: Record<string, GlossaryValue> = JSON5.parse(rebuilt);
  assert.deepEqual(reparsed["Attack"], { ru: "атака", cs: true });
  assert.equal(reparsed["Sect"], "секта");
  // toggling cs shows up as a change in the diff
  const noCs = parseSheet(csv.replace("Attack,атака,,true,", "Attack,атака,,,"));
  assert.equal(diffGlossary(parsed, noCs).changed.length, 1);
});

test("a new section with no known slug gets a bare _section_NN key", () => {
  const parsed: Record<string, GlossaryValue> = {}; // no existing sections to borrow a slug from
  const out = buildFile(parsed, parseSheet("EN,RU,feed,comment\r\n,,,Новое\r\nA,а,,\r\n"));
  assert.match(out, /"_section_01": "Новое"/);
});

test("diffGlossary classifies added / removed / changed (case-insensitive)", () => {
  const existing: Record<string, GlossaryValue> = { Qi: "Ци", Yang: "Ян" };
  const sheet = parseSheet("EN,RU,feed,comment\r\n,,,S\r\nqi,ЦИ-НОВ,,\r\nNew,Новый,,\r\n");
  const diff = diffGlossary(existing, sheet);
  assert.deepEqual(
    diff.added.map((t) => t.en),
    ["New"],
  );
  assert.deepEqual(
    diff.removed.map((o) => o.en),
    ["Yang"],
  );
  assert.deepEqual(
    diff.changed.map((c) => [c.from.ru, c.to.ru]),
    [["Ци", "ЦИ-НОВ"]],
  );
});

test("parseCsv handles quotes, escaped quotes, embedded commas and a BOM", () => {
  const rows = parseCsv('﻿EN,RU\r\n"a,b","he said ""hi"""\r\n');
  assert.deepEqual(rows, [
    ["EN", "RU"],
    ["a,b", 'he said "hi"'],
  ]);
});
