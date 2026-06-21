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

test("extract without markers yields a warning, no units", () => {
  const { units, warnings } = eventLanguagesAdapter.extract("just text\nno markers\n", null);
  assert.equal(units.length, 0);
  assert.ok(warnings.length > 0);
});
