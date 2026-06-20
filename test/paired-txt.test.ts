import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePairs, parseRaw, serializeRaw } from "../src/formats/paired-txt.js";

test("parseRaw/serializeRaw is a byte-exact inverse on edge cases", () => {
  const cases = [
    "",
    "\n",
    "\n\n",
    "a",
    "a\n",
    "a\nb",
    "a\nb\n",
    "a\nb\n\n",
    "key0\nvalue0\nkey1\n\n", // empty value
    "Name_0\nIron Ring\nName_1\nSteel Abacus\n\n",
  ];
  for (const input of cases) {
    assert.equal(serializeRaw(parseRaw(input)), input, JSON.stringify(input));
  }
});

test("parsePairs extracts keys, values and value indices", () => {
  const content = "Name_0\nIron Ring\nName_1\n\n";
  const { entries, warnings } = parsePairs(content);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    entries.map((e) => ({ key: e.key, value: e.value, valueIndex: e.valueIndex })),
    [
      { key: "Name_0", value: "Iron Ring", valueIndex: 1 },
      { key: "Name_1", value: "", valueIndex: 3 },
    ],
  );
});

test("parsePairs accepts rich keys (dots, spaces, trailing space)", () => {
  const content =
    "Adv.1 Actions.0 Desc\nThis is a variable\n" + "LK_Combat_Tips_1 \n Click the middle\n\n";
  const { warnings, entries } = parsePairs(content);
  assert.deepEqual(warnings, []);
  assert.equal(entries[0]!.key, "Adv.1 Actions.0 Desc");
  assert.equal(entries[1]!.key, "LK_Combat_Tips_1 "); // raw key preserved untrimmed
});

test("parsePairs flags a non-key on an odd line (desync detection)", () => {
  // A real-newline value pushes prose (with punctuation) onto a key line.
  const content = "Name_0\nA poem, broken across.\nlines here.\nName_1\n\n";
  const { warnings } = parsePairs(content);
  assert.ok(warnings.length > 0, "expected a desync warning");
});
