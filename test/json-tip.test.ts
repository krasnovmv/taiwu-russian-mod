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
