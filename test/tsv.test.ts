import assert from "node:assert/strict";
import { test } from "node:test";

import { tsvAdapter } from "../src/formats/tsv.js";

const TSV = '<align="center">Bush</align>\tEmerge here.\t<align="center">12</align>\n\n';

test("extract emits only cells with real text (skips number/markup-only)", () => {
  const { units } = tsvAdapter.extract(TSV, null);
  assert.deepEqual(
    units.map((u) => u.key),
    ["r0c0", "r0c1"],
  );
  assert.equal(units[0]!.en, '<align="center">Bush</align>');
  assert.equal(units[1]!.en, "Emerge here.");
});

test("CN cells are joined positionally", () => {
  const cn = '<align="center">灌木</align>\t在此出现。\t<align="center">12</align>\n\n';
  const { units } = tsvAdapter.extract(TSV, cn);
  assert.equal(units[0]!.cn, '<align="center">灌木</align>');
  assert.equal(units[1]!.cn, "在此出现。");
});

test("identity apply is byte-exact", () => {
  const { units } = tsvAdapter.extract(TSV, null);
  const out = tsvAdapter.apply(TSV, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true);
  assert.equal(out.content, TSV);
  assert.equal(out.applied, 0);
});

test("apply replaces a cell, preserving tabs and grid", () => {
  const out = tsvAdapter.apply(TSV, new Map([["r0c1", "Появись здесь."]]));
  assert.equal(out.guardOk, true);
  assert.equal(out.applied, 1);
  assert.equal(
    out.content,
    '<align="center">Bush</align>\tПоявись здесь.\t<align="center">12</align>\n\n',
  );
});

test("refuses a translation containing a tab or newline (grid hazard)", () => {
  const out = tsvAdapter.apply(TSV, new Map([["r0c1", "bad\tcell"]]));
  assert.equal(out.applied, 0);
  assert.equal(out.unsafe, 1);
  assert.deepEqual(out.unsafeKeys, ["r0c1"]);
  assert.equal(out.content, TSV);
});
