import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyGlossaryFeeds,
  glossarySignature,
  matchGlossary,
} from "../src/glossary/match.js";

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

const DOT = new Map([["phy. penetration", "Физ. урон"]]);
const FEEDS = new Map([["phy. penetration", "Physical Penetration"]]);

test("a term's feed surrogate rides along on the match", () => {
  assert.deepEqual(matchGlossary("boosts Phy. Penetration now", DOT, FEEDS), [
    { en: "phy. penetration", ru: "Физ. урон", feed: "Physical Penetration" },
  ]);
  // without a feeds map, no surrogate is attached (unchanged behaviour)
  assert.deepEqual(matchGlossary("boosts Phy. Penetration now", DOT), [
    { en: "phy. penetration", ru: "Физ. урон" },
  ]);
});

test("feed folds into the signature so it invalidates the cache", () => {
  const withFeed = glossarySignature(matchGlossary("Phy. Penetration", DOT, FEEDS));
  const without = glossarySignature(matchGlossary("Phy. Penetration", DOT));
  assert.notEqual(withFeed, without); // adding a feed re-keys the text
  assert.ok(withFeed.includes("Physical Penetration"));
});

test("applyGlossaryFeeds swaps the dotted term for its surrogate in text", () => {
  assert.equal(
    applyGlossaryFeeds("attacking boosts the user's Phy. Penetration.", DOT, FEEDS),
    "attacking boosts the user's Physical Penetration.",
  );
  // no feeds map, or a term without a surrogate → text unchanged
  assert.equal(
    applyGlossaryFeeds("boosts Phy. Penetration.", DOT),
    "boosts Phy. Penetration.",
  );
  assert.equal(applyGlossaryFeeds("just qi here", new Map([["qi", "ци"]]), FEEDS), "just qi here");
});
