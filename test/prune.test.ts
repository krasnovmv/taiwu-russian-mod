import assert from "node:assert/strict";
import { test } from "node:test";

import { orphanTmKeys } from "../src/tm/store.js";

test("keeps TMs that still have a source, prunes the rest", () => {
  const orphans = orphanTmKeys(
    ["Accessory_language.txt", "Weapon_language.txt"],
    ["Accessory_language.txt"],
  );
  assert.deepEqual(orphans, ["Weapon_language.txt"]);
});

test("prunes a deleted encyclopedia table (the Mingyu.tsv case)", () => {
  const orphans = orphanTmKeys(
    ["EncyclopediaAssets/Mingyu.tsv", "EncyclopediaAssets/Kept.tsv"],
    ["EncyclopediaAssets/Kept.tsv"],
  );
  assert.deepEqual(orphans, ["EncyclopediaAssets/Mingyu.tsv"]);
});

test("DLC version bump is not an orphan (TM key drops the version segment)", () => {
  // Source id carries a version; the stored TM key does not — they must still match.
  const stored = ["Event_DLC/Foo/Events/EventLanguages/Pack_Language_EN.txt"];
  const sources = ["Event_DLC/Foo/1.0.2/Events/EventLanguages/Pack_Language_EN.txt"];
  assert.deepEqual(orphanTmKeys(stored, sources), []);
});

test("a DLC TM with no surviving source is pruned", () => {
  const stored = ["Event_DLC/Gone/Events/EventLanguages/Pack_Language_EN.txt"];
  assert.deepEqual(orphanTmKeys(stored, []), stored);
});

test("nothing to prune when every stored key is backed", () => {
  const files = ["A.txt", "CommonTip/Event/x.json"];
  assert.deepEqual(orphanTmKeys(files, files), []);
});
