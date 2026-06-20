import assert from "node:assert/strict";
import { test } from "node:test";

import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../src/model/tm.js";
import { validateTm } from "../src/validate/qa.js";

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

test("detects empty output and newline hazard", () => {
  const issues = kinds(tm({ A: u("Hello world", ""), B: u("Hi there", "Привет\nмир") }));
  assert.ok(issues.includes("empty-output"));
  assert.ok(issues.includes("newline-hazard"));
});

test("detects untranslated (RU equals EN)", () => {
  assert.deepEqual(kinds(tm({ A: u("Iron Ring", "Iron Ring") })), ["untranslated"]);
});

test("detects length anomaly", () => {
  assert.deepEqual(kinds(tm({ A: u("A reasonably long sentence here", "X") })), ["length-anomaly"]);
});

test("pending units (ru=null) are ignored", () => {
  assert.deepEqual(validateTm(tm({ A: u("Hello world", null) })), []);
});
