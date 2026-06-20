import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTranslatedContent } from "../src/formats/paired-txt-build.js";

const ORIGINAL = "Name_0\nIron Ring\nName_1\nSteel Abacus\n\n";

test("applies RU values only to value lines; keys untouched; guard ok", () => {
  const r = buildTranslatedContent(ORIGINAL, new Map([["Name_0", "Железное кольцо"]]));
  assert.equal(r.guardOk, true);
  assert.equal(r.applied, 1);
  assert.equal(r.content, "Name_0\nЖелезное кольцо\nName_1\nSteel Abacus\n\n");
});

test("untranslated keys keep original EN value (partial translation)", () => {
  const r = buildTranslatedContent(ORIGINAL, new Map());
  assert.equal(r.applied, 0);
  assert.equal(r.content, ORIGINAL);
});

test("refuses RU values containing a real newline (alternation hazard)", () => {
  const r = buildTranslatedContent(ORIGINAL, new Map([["Name_0", "Железное\nкольцо"]]));
  assert.equal(r.applied, 0);
  assert.equal(r.unsafe, 1);
  assert.deepEqual(r.unsafeKeys, ["Name_0"]);
  assert.equal(r.content, ORIGINAL); // unchanged
  assert.equal(r.guardOk, true);
});

test("structural guard passes for multi-value rich-key files", () => {
  const original = "Adv.1 Desc\nA beggar nest...\nAdv.1 Name\nNest\n\n";
  const r = buildTranslatedContent(original, new Map([["Adv.1 Name", "Логово"]]));
  assert.equal(r.guardOk, true);
  assert.equal(r.content, "Adv.1 Desc\nA beggar nest...\nAdv.1 Name\nЛогово\n\n");
});
