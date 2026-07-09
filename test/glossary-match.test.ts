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
    { en: "qi", ru: "ци", src: "QI" },
    { en: "sect", ru: "секта", src: "Sect" },
  ]);
});

test("does not match inside a larger word", () => {
  assert.deepEqual(matchGlossary("acqitted sectarian", G), []);
});

test("matches multi-word terms", () => {
  assert.deepEqual(matchGlossary("a powerful Martial Art technique", G), [
    { en: "martial art", ru: "боевое искусство", src: "Martial Art" },
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
  // `src` (the text's casing) is NOT folded in: `Qi` and `qi` share one key
  const sig = glossarySignature(matchGlossary("Qi", G));
  assert.equal(sig, "qi=ци");
  assert.equal(glossarySignature(matchGlossary("qi", G)), sig);
  // changing the RU value changes the signature (so the cache invalidates)
  const sig2 = glossarySignature(matchGlossary("Qi", new Map([["qi", "чи"]])));
  assert.notEqual(sig, sig2);
});

// A `cs` term is stored under its exact-case key (the loader keeps it verbatim);
// an all-lowercase key stays case-insensitive.
const CS = new Map([
  ["Attack", "атака"],
  ["attack speed", "скорость атаки"],
  ["sect", "секта"],
]);

test("a cs term matches its exact casing only", () => {
  assert.deepEqual(matchGlossary("boosts Attack greatly", CS), [
    { en: "Attack", ru: "атака", src: "Attack" },
  ]);
  // lowercase prose ("rise and attack") is left to the engine
  assert.deepEqual(matchGlossary("they rise and attack the sect", CS), [
    { en: "sect", ru: "секта", src: "sect" },
  ]);
  assert.deepEqual(matchGlossary("ATTACK them", CS), []);
});

test("a longer case-insensitive term still consumes an embedded cs term", () => {
  // 'Attack Speed' must match as the two-word term, not as cs 'Attack' + noise —
  // splitting the alternation into two regexes must not change signatures.
  assert.deepEqual(matchGlossary("raises Attack Speed", CS), [
    { en: "attack speed", ru: "скорость атаки", src: "Attack Speed" },
  ]);
  const sig = glossarySignature(matchGlossary("raises Attack Speed", CS));
  assert.equal(sig, "attack speed=скорость атаки");
});

test("a cs match folds its exact-case key into the signature", () => {
  assert.equal(glossarySignature(matchGlossary("boosts Attack", CS)), "Attack=атака");
  assert.equal(glossarySignature(matchGlossary("rise and attack", CS)), "");
});

const DOT = new Map([["phy. penetration", "Физ. урон"]]);
const FEEDS = new Map([["phy. penetration", "Physical Penetration"]]);

test("a term's feed surrogate rides along on the match", () => {
  assert.deepEqual(matchGlossary("boosts Phy. Penetration now", DOT, FEEDS), [
    { en: "phy. penetration", ru: "Физ. урон", src: "Phy. Penetration", feed: "Physical Penetration" },
  ]);
  // without a feeds map, no surrogate is attached (unchanged behaviour)
  assert.deepEqual(matchGlossary("boosts Phy. Penetration now", DOT), [
    { en: "phy. penetration", ru: "Физ. урон", src: "Phy. Penetration" },
  ]);
});

test("feed folds into the signature so it invalidates the cache", () => {
  const withFeed = glossarySignature(matchGlossary("Phy. Penetration", DOT, FEEDS));
  const without = glossarySignature(matchGlossary("Phy. Penetration", DOT));
  assert.notEqual(withFeed, without); // adding a feed re-keys the text
  assert.ok(withFeed.includes("Physical Penetration"));
});

const TERMINAL_DOT = new Map([
  ["res.", "Сопр."],
  ["lv.", "Ур."],
]);
const TERMINAL_DOT_FEEDS = new Map([
  ["res.", "Resistance"],
  ["lv.", "Level"],
]);

test("a term ending in a period matches whatever follows the dot", () => {
  // after a period `\b` exists only before a word char, so these all need the
  // trailing anchor dropped: punctuation, markup, digits, or end of string
  for (const text of ["Acritoxin Res.-100", "Toxin Res.</align>", "Lv.1/Lv.2", "Lv.{0} Skills", "Res."]) {
    assert.ok(matchGlossary(text, TERMINAL_DOT, TERMINAL_DOT_FEEDS).length > 0, text);
  }
  // the leading word boundary still holds
  assert.deepEqual(matchGlossary("Tres. weird", TERMINAL_DOT), []);
});

test("applyGlossaryFeeds swaps a dot-terminal term for its surrogate", () => {
  assert.equal(
    applyGlossaryFeeds("Acritoxin Res.-100", TERMINAL_DOT, TERMINAL_DOT_FEEDS),
    "Acritoxin Resistance-100",
  );
  assert.equal(
    applyGlossaryFeeds("View all Lv.{0} Skills", TERMINAL_DOT, TERMINAL_DOT_FEEDS),
    "View all Level{0} Skills",
  );
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
