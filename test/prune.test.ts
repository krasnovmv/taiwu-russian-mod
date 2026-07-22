import assert from "node:assert/strict";
import { test } from "node:test";

import type { TmFile, TmUnit } from "../src/model/tm.js";
import { TM_SCHEMA_VERSION } from "../src/model/tm.js";
import { emptyOverwriteLoss, orphanTmKeys, serializeTm } from "../src/tm/store.js";

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

const unit: TmUnit = {
  en: "Iron Ring",
  cn: "铁指环",
  ru: "Железное кольцо",
  status: "machine",
  srcHash: "abc",
  engine: "yandex",
  updatedAt: null,
};

function tm(units: Record<string, TmUnit>): TmFile {
  return { schemaVersion: TM_SCHEMA_VERSION, file: "Demo.txt", glossaryVersion: 0, units };
}

test("blanking a populated TM is reported as a loss, never written", () => {
  const populated = serializeTm(tm({ Name_0: unit, Name_1: unit }));
  assert.equal(emptyOverwriteLoss(populated, tm({})), 2);
});

test("an empty TM over an empty or absent one is not a loss", () => {
  assert.equal(emptyOverwriteLoss(null, tm({})), 0); // first write of a new file
  assert.equal(emptyOverwriteLoss(serializeTm(tm({})), tm({})), 0);
});

test("shrinking a TM is normal and never blocked", () => {
  // Keys come and go as the game changes; only the total wipe is a parse failure.
  const populated = serializeTm(tm({ Name_0: unit, Name_1: unit }));
  assert.equal(emptyOverwriteLoss(populated, tm({ Name_0: unit })), 0);
});
