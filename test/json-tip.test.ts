import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonTipAdapter } from "../src/formats/json-tip.js";

// No trailing newline, matching the real game files.
const SRC =
  '{\n  "title": "Charm",\n  "type": "Default",\n  "name": "id1",\n  "value": "{Ref.X}",\n' +
  '  "paragraphs": [\n    {\n      "type": "SimpleContent",\n      "content": "Some text."\n    }\n  ]\n}';

test("extract picks only title and content (not type/name/value)", () => {
  const { units } = jsonTipAdapter.extract(SRC, null);
  assert.deepEqual(units.map((u) => u.key).sort(), ["paragraphs/0/content", "title"]);
});

test("JSONC source with // comments parses (JSON5), no guard failure", () => {
  // Some game tip files (e.g. CommonTip/Cricket/CricketSkillReplace.json) carry comments.
  const jsonc = '{\n  // a comment\n  "title": "Charm",\n  "content": "Some text.",\n}';
  const { units, warnings } = jsonTipAdapter.extract(jsonc, null);
  assert.equal(warnings.length, 0);
  assert.deepEqual(units.map((u) => u.key).sort(), ["content", "title"]);

  const out = jsonTipAdapter.apply(jsonc, new Map([["title", "Очарование"]]));
  assert.equal(out.guardOk, true);
  assert.equal(out.applied, 1);
  // Surgical apply: only the translated string token changes, the comment stays.
  assert.equal(out.content, jsonc.replace('"Charm"', '"Очарование"'));
});

// Mirrors CommonTip/Cricket/CricketSkillReplace.json: `///` comment lines
// between one-line atom objects. Neither survives a JSON.stringify round-trip,
// so apply must be text-surgical.
const CRICKET =
  '{\n  "title": "Cricket Skills",\n  "paragraphs": [\n    {\n      "type": "Default",\n' +
  '      "atoms": [\n        /// 令 SkillName 为 王血\n' +
  '        { "type": "SubTitle", "marginLeft": 0, "content": "{SkillName}" },\n' +
  '        { "type": "SubTitle2", "marginLeft": 0, "content": "发动时机" }\n' +
  "      ]\n    }\n  ]\n}";

test("JSONC with /// comments and one-line atoms: identity apply is byte-exact", () => {
  const { units } = jsonTipAdapter.extract(CRICKET, null);
  const out = jsonTipAdapter.apply(CRICKET, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
  assert.equal(out.content, CRICKET);
});

test("JSONC with /// comments: translation keeps comments and formatting", () => {
  const out = jsonTipAdapter.apply(
    CRICKET,
    new Map([["paragraphs/0/atoms/1/content", "Момент активации"]]),
  );
  assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
  assert.equal(out.applied, 1);
  assert.equal(out.content, CRICKET.replace('"发动时机"', '"Момент активации"'));
});

test("CN reference joined by path", () => {
  const cn = SRC.replace('"Charm"', '"魅力"').replace('"Some text."', '"一些文字。"');
  const { units } = jsonTipAdapter.extract(SRC, cn);
  const byKey = new Map(units.map((u) => [u.key, u.cn]));
  assert.equal(byKey.get("title"), "魅力");
  assert.equal(byKey.get("paragraphs/0/content"), "一些文字。");
});

test("identity apply is byte-exact (preserves no-trailing-newline)", () => {
  const { units } = jsonTipAdapter.extract(SRC, null);
  const out = jsonTipAdapter.apply(SRC, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true);
  assert.equal(out.content, SRC);
});

test("apply translates title/content and guard passes", () => {
  const out = jsonTipAdapter.apply(
    SRC,
    new Map([
      ["title", "Шарм"],
      ["paragraphs/0/content", "Текст."],
    ]),
  );
  assert.equal(out.guardOk, true);
  assert.equal(out.applied, 2);
  const obj = JSON.parse(out.content) as {
    title: string;
    name: string;
    paragraphs: { content: string }[];
  };
  assert.equal(obj.title, "Шарм");
  assert.equal(obj.paragraphs[0]!.content, "Текст.");
  assert.equal(obj.name, "id1"); // untouched
});
