import assert from "node:assert/strict";
import { test } from "node:test";

import { optionTipsAdapter } from "../src/formats/option-tips.js";

const EN = "Taiwu has less than {0} companion(s).\nFavorability is at or above {0}.\n\n{0} is not a companion.\n";
const CN = "太吾同道的数量少于{0}\n好感度不低于{0}\n\n{0}不为同道\n";

test("extract: one unit per non-blank line, keyed by index, CN-aligned", () => {
  const { units, warnings } = optionTipsAdapter.extract(EN, CN);
  assert.equal(warnings.length, 0);
  assert.deepEqual(
    units.map((u) => [u.key, u.en, u.cn]),
    [
      ["0", "Taiwu has less than {0} companion(s).", "太吾同道的数量少于{0}"],
      ["1", "Favorability is at or above {0}.", "好感度不低于{0}"],
      ["3", "{0} is not a companion.", "{0}不为同道"],
    ],
  );
});

test("extract: warns on EN/CN line-count mismatch", () => {
  const { warnings } = optionTipsAdapter.extract("a\nb\n", "x\n");
  assert.equal(warnings.length, 1);
});

test("apply: replaces by index, preserves blank lines and line count", () => {
  const tr = new Map([
    ["0", "У Тайу меньше {0} соратников."],
    ["3", "{0} не соратник."],
  ]);
  const r = optionTipsAdapter.apply(EN, tr);
  assert.equal(r.guardOk, true);
  assert.equal(r.applied, 2);
  assert.equal(
    r.content,
    "У Тайу меньше {0} соратников.\nFavorability is at or above {0}.\n\n{0} не соратник.\n",
  );
});

test("apply: refuses a translation that injects a newline (would shift lines)", () => {
  const r = optionTipsAdapter.apply(EN, new Map([["0", "line one\nline two"]]));
  assert.equal(r.applied, 0);
  assert.equal(r.unsafe, 1);
  assert.deepEqual(r.unsafeKeys, ["0"]);
  assert.equal(r.content, EN); // unchanged
  assert.equal(r.guardOk, true);
});
