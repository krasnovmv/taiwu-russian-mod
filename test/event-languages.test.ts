import assert from "node:assert/strict";
import { test } from "node:test";

import { eventLanguagesAdapter } from "../src/formats/event-languages.js";

// EN: two event blocks. Block 1 has an inline EventContent + Option_1; block 2
// is "block style" — the EventContent value is empty after the colon and spills
// onto the next physical line (a real newline), like the real Ending chapters.
// EventName is an internal identifier and must NOT become a unit.
const EN =
  "- EventGuid : g1\n" +
  "\t- EventName : name_one\n" +
  "\t\t-- EventContent : Hello <Character key=RoleTaiwu str=Name/>.<NL>Welcome.\n" +
  "\t\t-- Option_1 : (Look around...)\n" +
  "- EventGuid : g2\n" +
  "\t- EventName : name_two\n" +
  "\t\t-- EventContent : \n" +
  "A line that spills over.\n" +
  "\t\t-- Option_1 : Leave.\n";

// CN: headered, and the GUIDs are in the OPPOSITE order — pairing is by GUID.
const CN =
  "- Group : Demo\n" +
  "- GroupName : 测试\n" +
  "- Language : CN\n" +
  "\n" +
  "- EventGuid : g2\n" +
  "\t- EventName : name_two\n" +
  "\t\t-- EventContent : \n" +
  "溢出的一行。\n" +
  "\t\t-- Option_1 : 离开。\n" +
  "- EventGuid : g1\n" +
  "\t- EventName : name_one\n" +
  "\t\t-- EventContent : 你好 <Character key=RoleTaiwu str=Name/>。<NL>欢迎。\n" +
  "\t\t-- Option_1 : （四处看看……）\n";

test("extract pulls EventContent/Option keyed by GUID, skips EventName", () => {
  const { units, warnings } = eventLanguagesAdapter.extract(EN, CN);
  assert.deepEqual(warnings, []);
  const byKey = new Map(units.map((u) => [u.key, u]));
  // Exactly the player-facing markers, two per block.
  assert.deepEqual([...byKey.keys()].sort(), [
    "g1/EventContent",
    "g1/Option_1",
    "g2/EventContent",
    "g2/Option_1",
  ]);
  // No EventGuid/EventName units.
  assert.ok(![...byKey.keys()].some((k) => k.includes("EventName")));
});

test("extract recovers inline and block-style (multi-line) values", () => {
  const { units } = eventLanguagesAdapter.extract(EN, CN);
  const byKey = new Map(units.map((u) => [u.key, u]));
  assert.equal(
    byKey.get("g1/EventContent")!.en,
    "Hello <Character key=RoleTaiwu str=Name/>.<NL>Welcome.",
  );
  // Block-style: empty inline part, value continues on the next line.
  assert.equal(byKey.get("g2/EventContent")!.en, "\nA line that spills over.");
  assert.equal(byKey.get("g1/Option_1")!.en, "(Look around...)");
});

test("CN reference is matched by GUID despite reordering", () => {
  const { units } = eventLanguagesAdapter.extract(EN, CN);
  const byKey = new Map(units.map((u) => [u.key, u]));
  assert.equal(byKey.get("g1/Option_1")!.cn, "（四处看看……）");
  assert.equal(byKey.get("g2/Option_1")!.cn, "离开。");
  assert.equal(byKey.get("g2/EventContent")!.cn, "\n溢出的一行。");
});

test("identity apply is byte-exact", () => {
  const { units } = eventLanguagesAdapter.extract(EN, CN);
  const out = eventLanguagesAdapter.apply(EN, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true);
  assert.equal(out.content, EN);
});

test("apply replaces inline and block-style values", () => {
  const map = new Map<string, string>([
    ["g1/Option_1", "(Осмотреться...)"],
    ["g2/EventContent", "\nСтрока с переносом."],
  ]);
  const out = eventLanguagesAdapter.apply(EN, map);
  assert.equal(out.guardOk, true);
  assert.equal(out.applied, 2);
  assert.ok(out.content.includes("\t\t-- Option_1 : (Осмотреться...)\n"));
  assert.ok(out.content.includes("\t\t-- EventContent : \nСтрока с переносом.\n"));
  // Untouched lines stay verbatim.
  assert.ok(out.content.includes("\t- EventName : name_two\n"));
});

test("apply refuses to write if a translation injects a marker-shaped line", () => {
  const malicious = new Map<string, string>([
    ["g1/EventContent", "oops\n\t\t-- Option_1 : injected"],
  ]);
  const out = eventLanguagesAdapter.apply(EN, malicious);
  assert.equal(out.guardOk, false);
  assert.equal(out.content, EN); // original returned unchanged
});

// The 2026-07-22 game update rewrote 207 event packages with CRLF endings. The
// anchor pattern cannot match a line that still carries its "\r", so extraction
// silently collapsed to zero units — and the pipeline wrote that empty result
// over the existing translations.
const EN_CRLF = EN.replace(/\n/g, "\r\n");
const CN_CRLF = CN.replace(/\n/g, "\r\n");

test("extract yields the same units from a CRLF file as from LF", () => {
  const lf = eventLanguagesAdapter.extract(EN, CN);
  const crlf = eventLanguagesAdapter.extract(EN_CRLF, CN_CRLF);
  assert.deepEqual(crlf.warnings, []);
  assert.ok(crlf.units.length > 0, "CRLF file must still extract units");
  // Byte-identical units: no "\r" in the values, so srcHash and cache keys are
  // unchanged by the game's reflow.
  assert.deepEqual(crlf.units, lf.units);
});

test("identity apply on a CRLF file is byte-exact and keeps CRLF", () => {
  const { units } = eventLanguagesAdapter.extract(EN_CRLF, CN_CRLF);
  const out = eventLanguagesAdapter.apply(EN_CRLF, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true);
  assert.equal(out.content, EN_CRLF);
});

test("apply writes a CRLF file back with CRLF endings", () => {
  const out = eventLanguagesAdapter.apply(EN_CRLF, new Map([["g1/Option_1", "(Осмотреться...)"]]));
  assert.equal(out.guardOk, true);
  assert.equal(out.applied, 1);
  assert.ok(out.content.includes("\t\t-- Option_1 : (Осмотреться...)\r\n"));
  assert.ok(!/[^\r]\n/.test(out.content), "no bare LF may survive in a CRLF file");
});

test("extract without markers yields a warning, no units", () => {
  const { units, warnings } = eventLanguagesAdapter.extract("just text\nno markers\n", null);
  assert.equal(units.length, 0);
  assert.ok(warnings.length > 0);
});

test("a stale EN event takes every option from CN and gets the missing ones", () => {
  // CN inserted a new Option_2, so EN Option_2 is really the game's Option_3.
  const en =
    "- EventGuid : g1\n" +
    "\t- EventName : n\n" +
    "\t\t-- EventContent : Hi.\n" +
    "\t\t-- Option_1 : Ask.\n" +
    "\t\t-- Option_2 : Leave.\n" +
    "\n" +
    "- EventGuid : g2\n" +
    "\t- EventName : m\n" +
    "\t\t-- EventContent : Yo.\n" +
    "\t\t-- Option_1 : Ok.\n";
  const cn =
    "- EventGuid : g1\n" +
    "\t- EventName : n\n" +
    "\t\t-- EventContent : 你好。\n" +
    "\t\t-- Option_1 : 问。\n" +
    "\t\t-- Option_2 : 新。\n" +
    "\t\t-- Option_3 : 走。\n" +
    "- EventGuid : g2\n" +
    "\t- EventName : m\n" +
    "\t\t-- EventContent : 哟。\n" +
    "\t\t-- Option_1 : 好。\n";
  const { units, onlyCn } = eventLanguagesAdapter.extract(en, cn);
  assert.deepEqual(onlyCn, []);
  const byKey = new Map(units.map((u) => [u.key, u]));
  assert.deepEqual(byKey.get("g1/Option_2"), {
    key: "g1/Option_2",
    en: "新。",
    cn: null,
    srcLang: "zh",
  });
  assert.equal(byKey.get("g1/Option_3")?.en, "走。");
  assert.equal(byKey.get("g1/EventContent")?.en, "Hi."); // content stays EN-sourced
  assert.equal(byKey.get("g2/Option_1")?.en, "Ok."); // other events untouched

  const map = new Map(units.map((u) => [u.key, `RU(${u.en})`]));
  const out = eventLanguagesAdapter.apply(en, map);
  assert.equal(out.guardOk, true, out.guardError ?? "");
  assert.equal(
    out.content,
    "- EventGuid : g1\n" +
      "\t- EventName : n\n" +
      "\t\t-- EventContent : RU(Hi.)\n" +
      "\t\t-- Option_1 : RU(问。)\n" +
      "\t\t-- Option_2 : RU(新。)\n" +
      "\t\t-- Option_3 : RU(走。)\n" +
      "\n" +
      "- EventGuid : g2\n" +
      "\t- EventName : m\n" +
      "\t\t-- EventContent : RU(Yo.)\n" +
      "\t\t-- Option_1 : RU(Ok.)\n",
  );
});

test("an EN event is stale whenever its option shape disagrees with CN", () => {
  const block = (lang: string, opts: string[]) =>
    `- EventGuid : g1\n\t- EventName : n\n\t\t-- EventContent : ${lang}\n` +
    opts.map((o, i) => `\t\t-- Option_${i + 1} : ${o}\n`).join("");
  const zhKeys = (en: string, cn: string) =>
    eventLanguagesAdapter
      .extract(en, cn)
      .units.filter((u) => u.srcLang === "zh")
      .map((u) => u.key);
  // Same count, different repeats: EN lost the distinct texts of 2 and 3.
  assert.deepEqual(zhKeys(block("x", ["A", "B", "B"]), block("甲", ["甲", "乙", "丙"])), [
    "g1/Option_1",
    "g1/Option_2",
    "g1/Option_3",
  ]);
  // EN has an option CN dropped: the CN ones are re-sourced, the extra keeps EN.
  assert.deepEqual(zhKeys(block("x", ["A", "B", "C"]), block("甲", ["甲", "乙"])), [
    "g1/Option_1",
    "g1/Option_2",
  ]);
  // Matching shape: nothing changes.
  assert.deepEqual(zhKeys(block("x", ["A", "A", "C"]), block("甲", ["甲", "甲", "丙"])), []);
});
