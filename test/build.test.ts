import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTranslatedContent } from "../src/apply/build.js";
import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../src/model/tm.js";

function unit(en: string, ru: string | null): TmUnit {
  return {
    en,
    cn: null,
    ru,
    status: ru ? "machine" : "pending",
    srcHash: "x",
    engine: "mock",
    updatedAt: null,
  };
}

function tmOf(units: Record<string, TmUnit>): TmFile {
  return { schemaVersion: TM_SCHEMA_VERSION, file: "Demo.txt", glossaryVersion: 0, units };
}

const ORIGINAL = "Name_0\nIron Ring\nName_1\nSteel Abacus\n\n";

test("applies RU values only to value lines; keys untouched; guard ok", () => {
  const tm = tmOf({ Name_0: unit("Iron Ring", "Железное кольцо") });
  const r = buildTranslatedContent(ORIGINAL, tm);
  assert.equal(r.guardOk, true);
  assert.equal(r.applied, 1);
  assert.equal(r.content, "Name_0\nЖелезное кольцо\nName_1\nSteel Abacus\n\n");
});

test("untranslated units keep original EN value (partial translation)", () => {
  const tm = tmOf({ Name_0: unit("Iron Ring", null) });
  const r = buildTranslatedContent(ORIGINAL, tm);
  assert.equal(r.applied, 0);
  assert.equal(r.content, ORIGINAL);
});

test("refuses RU values containing a real newline (alternation hazard)", () => {
  const tm = tmOf({ Name_0: unit("Iron Ring", "Железное\nкольцо") });
  const r = buildTranslatedContent(ORIGINAL, tm);
  assert.equal(r.applied, 0);
  assert.equal(r.unsafe, 1);
  assert.deepEqual(r.unsafeKeys, ["Name_0"]);
  assert.equal(r.content, ORIGINAL); // unchanged
  assert.equal(r.guardOk, true);
});

test("structural guard passes for multi-value rich-key files", () => {
  const original = "Adv.1 Desc\nA beggar nest...\nAdv.1 Name\nNest\n\n";
  const tm = tmOf({ "Adv.1 Name": unit("Nest", "Логово") });
  const r = buildTranslatedContent(original, tm);
  assert.equal(r.guardOk, true);
  assert.equal(r.content, "Adv.1 Desc\nA beggar nest...\nAdv.1 Name\nЛогово\n\n");
});
