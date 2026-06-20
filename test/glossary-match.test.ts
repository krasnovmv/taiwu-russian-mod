import assert from "node:assert/strict";
import { test } from "node:test";

import { glossarySignature, matchGlossary } from "../src/glossary/match.js";

const G = new Map([
  ["qi", "ци"],
  ["sect", "секта"],
  ["martial art", "боевое искусство"],
]);

test("matches glossary terms as whole words, case-insensitively", () => {
  const got = matchGlossary("Restore your QI in the Sect.", G);
  assert.deepEqual(got, [
    { en: "qi", ru: "ци" },
    { en: "sect", ru: "секта" },
  ]);
});

test("does not match inside a larger word", () => {
  assert.deepEqual(matchGlossary("acqitted sectarian", G), []);
});

test("matches multi-word terms", () => {
  assert.deepEqual(matchGlossary("a powerful Martial Art technique", G), [
    { en: "martial art", ru: "боевое искусство" },
  ]);
});

test("deduplicates repeats and orders deterministically", () => {
  const a = matchGlossary("Sect, qi, Sect, QI", G);
  const b = matchGlossary("qi Sect", G);
  assert.deepEqual(a, b); // same set regardless of order/repetition
});

test("empty glossary matches nothing", () => {
  assert.deepEqual(matchGlossary("Qi and Sect", new Map()), []);
});

test("signature is empty when no terms apply, stable when they do", () => {
  assert.equal(glossarySignature(matchGlossary("nothing here", G)), "");
  const sig = glossarySignature(matchGlossary("Qi", G));
  assert.equal(sig, "qi=ци");
  // changing the RU value changes the signature (so the cache invalidates)
  const sig2 = glossarySignature(matchGlossary("Qi", new Map([["qi", "чи"]])));
  assert.notEqual(sig, sig2);
});
