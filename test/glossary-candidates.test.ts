import assert from "node:assert/strict";
import { test } from "node:test";

import { collectCandidates, type SourceText } from "../src/glossary/candidates.js";

const unit = (en: string, file = "f.txt"): SourceText => ({ file, en, cn: null });

test("harvests multi-word Title-Case proper nouns on frequency alone", () => {
  const texts = Array.from({ length: 3 }, () => unit("Enter the Sect Tournament now."));
  const got = collectCandidates(texts, { minCount: 3 });
  const term = got.find((c) => c.key === "sect tournament");
  assert.ok(term, "expected 'Sect Tournament' as a candidate");
  assert.equal(term.count, 3);
  assert.equal(term.words, 2);
});

test("keeps connectors inside a run but not at its edges", () => {
  const texts = Array.from({ length: 3 }, () => unit("This is the Scroll of Taiwu, indeed."));
  const got = collectCandidates(texts, { minCount: 3 });
  assert.ok(got.some((c) => c.term === "Scroll of Taiwu"));
  // The trailing connector "of" must not produce "Taiwu of" or similar.
  assert.ok(!got.some((c) => /\bof$/i.test(c.key)));
});

test("single capitalised words need a mid-sentence signal", () => {
  // 'Sword' only ever starts a sentence → grammatical caps, not a term.
  const sentenceStart = Array.from({ length: 5 }, () => unit("Sword broke."));
  assert.ok(!collectCandidates(sentenceStart, { minCount: 3 }).some((c) => c.key === "sword"));

  // 'Qi' recurs mid-sentence → meaningful caps, kept.
  const midSentence = Array.from({ length: 5 }, () => unit("Channel your Qi inward."));
  assert.ok(collectCandidates(midSentence, { minCount: 3 }).some((c) => c.key === "qi"));
});

test("drops function words and contractions as single-word terms", () => {
  const texts = Array.from({ length: 5 }, () => unit("Truly, It's The end."));
  const got = collectCandidates(texts, { minCount: 3 });
  assert.ok(!got.some((c) => c.key === "the"));
  assert.ok(!got.some((c) => /['’]/.test(c.key)));
});

test("excludes terms already in the glossary", () => {
  const texts = Array.from({ length: 4 }, () => unit("Channel your Qi and meet Taiwu."));
  const glossary = new Map([["qi", "ци"]]);
  const got = collectCandidates(texts, { minCount: 3, glossary });
  assert.ok(!got.some((c) => c.key === "qi"));
});

test("strips markup so tags never leak into candidates", () => {
  const texts = Array.from({ length: 3 }, () =>
    unit("<color=#brightred>Iron Ring</color> {0} grants Power."),
  );
  const got = collectCandidates(texts, { minCount: 3 });
  assert.ok(got.some((c) => c.term === "Iron Ring"));
  assert.ok(!got.some((c) => /color|brightred/.test(c.key)));
});

test("respects minCount and counts distinct files", () => {
  const texts = [unit("Jade Seal here.", "a.txt"), unit("Jade Seal there.", "b.txt")];
  assert.equal(collectCandidates(texts, { minCount: 3 }).length, 0);
  const kept = collectCandidates(texts, { minCount: 2 }).find((c) => c.key === "jade seal");
  assert.ok(kept);
  assert.equal(kept.files, 2);
});
