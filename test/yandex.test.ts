import assert from "node:assert/strict";
import { test } from "node:test";

import {
  YandexEngine,
  batchByChars,
  decodeHtmlEntities,
  glossaryPairsForTexts,
} from "../src/engine/yandex.js";

test("batchByChars respects the character budget", () => {
  const texts = ["aaaa", "bbbb", "cccc"]; // 4 chars each
  const batches = batchByChars(texts, 8, 100);
  assert.deepEqual(batches, [["aaaa", "bbbb"], ["cccc"]]);
});

test("batchByChars respects the max-texts cap", () => {
  const texts = ["a", "b", "c", "d", "e"];
  const batches = batchByChars(texts, 1000, 2);
  assert.deepEqual(batches, [["a", "b"], ["c", "d"], ["e"]]);
});

test("a single oversized text is its own batch (never dropped)", () => {
  const texts = ["x".repeat(50), "y"];
  const batches = batchByChars(texts, 10, 100);
  assert.deepEqual(batches, [["x".repeat(50)], ["y"]]);
});

test("glossaryPairsForTexts builds exact:false pairs for terms in the batch", () => {
  const glossary = new Map([
    ["qi", "ци"],
    ["sect", "секта"],
    ["loong", "лун"],
  ]);
  const pairs = glossaryPairsForTexts(["Restore your Qi in the Sect", "again the Sect"], glossary);
  // the pair source keeps the casing the term has in the request text
  assert.deepEqual(pairs, [
    { sourceText: "Qi", translatedText: "ци", exact: false },
    { sourceText: "Sect", translatedText: "секта", exact: false },
  ]);
  // a term that never appears is omitted
  assert.ok(!pairs.some((p) => p.sourceText === "loong"));
});

test("glossaryPairsForTexts uses the feed surrogate as the pair source", () => {
  const glossary = new Map([["phy. penetration", "Физ. урон"]]);
  const feeds = new Map([["phy. penetration", "Physical Penetration"]]);
  const pairs = glossaryPairsForTexts(["boosts Phy. Penetration"], glossary, feeds);
  assert.deepEqual(pairs, [
    { sourceText: "Physical Penetration", translatedText: "Физ. урон", exact: false },
  ]);
  // without feeds, the raw (dotted) term is the source, in the text's casing
  const raw = glossaryPairsForTexts(["boosts Phy. Penetration"], glossary);
  assert.equal(raw[0]?.sourceText, "Phy. Penetration");
});

test("glossaryPairsForTexts collapses a feed colliding with a literal term", () => {
  // `Res.` feeds `Resistance`, which is itself a glossary term: Yandex must not
  // receive two pairs with the same sourceText
  const glossary = new Map([
    ["res.", "Сопр."],
    ["resistance", "Сопротивление"],
  ]);
  const feeds = new Map([["res.", "Resistance"]]);
  const pairs = glossaryPairsForTexts(["Toxin Res. lowers Resistance"], glossary, feeds);
  const sources = pairs.map((p) => p.sourceText.toLowerCase());
  assert.equal(new Set(sources).size, sources.length);
  assert.equal(pairs.length, 1);
});

test("glossaryPairsForTexts is empty without a glossary or matches", () => {
  assert.deepEqual(glossaryPairsForTexts(["plain text"], new Map()), []);
  assert.deepEqual(glossaryPairsForTexts(["plain text"], new Map([["qi", "ци"]])), []);
});

test("decodeHtmlEntities reverses Yandex's HTML-mode escaping", () => {
  assert.equal(decodeHtmlEntities("Плодовитость &gt; 50"), "Плодовитость > 50");
  assert.equal(decodeHtmlEntities("&lt;= 60"), "<= 60");
  assert.equal(decodeHtmlEntities("Refine &amp; Envenom"), "Refine & Envenom");
  assert.equal(decodeHtmlEntities("&quot;x&quot; &#39;y&#39;"), "\"x\" 'y'");
  // a genuine literal `&gt;` in the source arrives double-escaped; keep it intact
  assert.equal(decodeHtmlEntities("&amp;gt;"), "&gt;");
  // `<mN>` sentinels are real tags in HTML mode, never escaped — left untouched
  assert.equal(decodeHtmlEntities("<m0>текст</m0>"), "<m0>текст</m0>");
});

/** An engine whose gRPC client is replaced by a scripted stub (no yc, no network). */
function engineWith(translate: () => Promise<{ translations: { text: string }[] }>): YandexEngine {
  const engine = new YandexEngine({
    getIamToken: () => Promise.resolve("t"),
    getFolderId: () => Promise.resolve("f"),
  });
  (engine as unknown as { client: unknown }).client = { translate };
  return engine;
}

test("a batch reply of the right length is scattered back in order", async () => {
  const engine = engineWith(() =>
    Promise.resolve({ translations: [{ text: "один" }, { text: "два" }] }),
  );
  assert.deepEqual(await engine.translate([{ text: "one" }, { text: "two" }]), ["один", "два"]);
});

test("a batch reply of the wrong length aborts — never scattered onto wrong units", async () => {
  // A short reply would shift every later translation onto the wrong key: silent
  // TM/cache cross-contamination that per-unit validation cannot catch.
  let calls = 0;
  const engine = engineWith(() => {
    calls++;
    return Promise.resolve({ translations: [{ text: "только один" }] });
  });
  await assert.rejects(
    engine.translate([{ text: "one" }, { text: "two" }]),
    /returned 1 translations for 2 texts/,
  );
  // A malformed *successful* reply is not a transient failure: no retry billing.
  assert.equal(calls, 1);
});

test("YandexEngine.fromEnv builds an engine (yc creds resolved lazily)", () => {
  const engine = YandexEngine.fromEnv();
  assert.equal(engine.id, "yandex");
});

test("credentials are resolved lazily, not at construction", () => {
  let tokenCalls = 0;
  let folderCalls = 0;
  const engine = new YandexEngine({
    getIamToken: () => {
      tokenCalls++;
      return Promise.resolve("t");
    },
    getFolderId: () => {
      folderCalls++;
      return Promise.resolve("f");
    },
  });
  assert.equal(tokenCalls, 0); // constructing must not resolve credentials
  assert.equal(folderCalls, 0);
  assert.equal(engine.id, "yandex");
});
