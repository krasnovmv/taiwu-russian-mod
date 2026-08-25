import assert from "node:assert/strict";
import { test } from "node:test";

import { alignCnRows, anchorColumns } from "../src/formats/tsv-align.js";
import { tsvAdapter } from "../src/formats/tsv.js";

/** `id` is the language-independent last column; `name` is translated. */
const enRow = (id: string, name: string): string[] => [name, id];
const cnRow = (id: string, name: string): string[] => [name, id];

test("anchorColumns finds the column that reads the same in both languages", () => {
  const en = [enRow("a1", "Sect"), enRow("a2", "Valley"), enRow("a3", "Peak")];
  const cn = [cnRow("a1", "门派"), cnRow("a2", "山谷"), cnRow("a3", "山峰")];
  // Column 1 holds ids (identical), column 0 holds prose (nothing in common).
  assert.deepEqual(anchorColumns(en, cn), [1]);
});

test("anchorColumns reports none when every column is translated", () => {
  const en = [["Bush"], ["Rock"]];
  const cn = [["灌木"], ["岩石"]];
  assert.deepEqual(anchorColumns(en, cn), []);
});

test("an entry present only in EN does not shift the rows after it", () => {
  // The shipped bug in miniature: EN carries `a3`, CN does not, and everything
  // downstream used to be paired with the next entry's Chinese.
  const en = [enRow("a1", "One"), enRow("a2", "Two"), enRow("a3", "Three"), enRow("a4", "Four")];
  const cn = [cnRow("a1", "一"), cnRow("a2", "二"), cnRow("a4", "四")];

  const aligned = alignCnRows(en, cn);

  assert.equal(aligned[0]?.[0], "一");
  assert.equal(aligned[1]?.[0], "二");
  assert.equal(aligned[2], null); // no Chinese for a3 — better than a wrong one
  assert.equal(aligned[3]?.[0], "四"); // a4 still finds its own row
});

test("an entry present only in CN is skipped over, not consumed", () => {
  const en = [enRow("a1", "One"), enRow("a2", "Two")];
  const cn = [cnRow("a1", "一"), cnRow("a9", "九"), cnRow("a2", "二")];

  const aligned = alignCnRows(en, cn);

  assert.equal(aligned[0]?.[0], "一");
  assert.equal(aligned[1]?.[0], "二");
});

test("without an anchor column the pairing stays positional", () => {
  const en = [["Bush"], ["Rock"]];
  const cn = [["灌木"], ["岩石"]];
  assert.deepEqual(alignCnRows(en, cn), [["灌木"], ["岩石"]]);
});

test("a pair whose markup structure disagrees is dropped", () => {
  // Same id, but one side wraps the text in a link and the other does not: the
  // rows cannot be describing the same cell, so no Chinese is better than this.
  const en = [['<align="center"><u><link="x">Gold</link></u></align>', "a1"]];
  const cn = [['<align="center">黄金</align>', "a1"]];
  assert.equal(alignCnRows(en, cn)[0], null);
});

test("a pair is kept when only an attribute VALUE differs between the packs", () => {
  // Cuzhi_Teshu.tsv really does grade one row #GradeColor_8 in English and
  // #GradeColor_0 in Chinese. Comparing tags verbatim threw such pairs away.
  const en = [['<align="center"><color=#GradeColor_8>Tier 1</color></align>', "a1"]];
  const cn = [['<align="center"><color=#GradeColor_0>一品</color></align>', "a1"]];
  assert.equal(
    alignCnRows(en, cn)[0]?.[0],
    '<align="center"><color=#GradeColor_0>一品</color></align>',
  );
});

test("a `link` id is part of the check, so two different entries never pair", () => {
  const en = [['<u><link="促织-八败">Champion</link></u>', "a1"]];
  const cn = [['<u><link="促织-三太子">三太子</link></u>', "a1"]];
  assert.equal(alignCnRows(en, cn)[0], null);
});

test("no CN table at all leaves every row unpaired", () => {
  assert.deepEqual(alignCnRows([["Bush"], ["Rock"]], []), [null, null]);
});

test("extract takes a unit's CN from the row of the SAME entry", () => {
  // Row 1 of EN has no counterpart, so row 2's Chinese must not slide up into it.
  const en = "One\ta1\nTwo\ta2\nThree\ta3\n\n";
  const cn = "一\ta1\n三\ta3\n\n";

  const { units } = tsvAdapter.extract(en, cn);
  const byKey = new Map(units.map((u) => [u.key, u]));

  assert.equal(byKey.get("r0c0")?.cn, "一");
  assert.equal(byKey.get("r1c0")?.cn, null);
  assert.equal(byKey.get("r2c0")?.cn, "三");
});
