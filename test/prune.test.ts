import assert from "node:assert/strict";
import { test } from "node:test";

import type { TmFile, TmUnit } from "../src/model/tm.js";
import { TM_SCHEMA_VERSION } from "../src/model/tm.js";
import {
  emptyOverwriteLoss,
  orphanTmKeys,
  partitionOrphans,
  serializeTm,
} from "../src/tm/store.js";

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

test("a family listing zero sources is withheld, not pruned (dangling junction)", () => {
  // Root quests: EN and CN share the ONE Event_Languages junction, so a dangling
  // link empties both lists at once and the whole 47k-unit corpus reads as
  // orphaned. That must never be deleted silently.
  const orphans = [
    "Event_Languages/Taiwu_EventPackage_A_Language_EN.txt",
    "Event_Languages/Taiwu_EventPackage_B_Language_EN.txt",
  ];
  const sources = ["Accessory_language.txt"]; // main pack fine, junction gone
  assert.deepEqual(partitionOrphans(orphans, sources), {
    prune: [],
    withheld: [{ prefix: "Event_Languages/", keys: orphans }],
  });
});

test("one file gone from a family that still lists others IS pruned", () => {
  const orphans = ["Event_Languages/Taiwu_EventPackage_Removed_Language_EN.txt"];
  const sources = ["Event_Languages/Taiwu_EventPackage_Kept_Language_EN.txt"];
  assert.deepEqual(partitionOrphans(orphans, sources), { prune: orphans, withheld: [] });
});

test("family presence is judged on TM keys, so a versioned DLC source counts", () => {
  // The DLC source id carries a version segment; family matching must see it as
  // Event_DLC presence all the same (tmKey strips the version).
  const orphans = ["Event_DLC/Gone/Events/EventLanguages/Pack_Language_EN.txt"];
  const sources = ["Event_DLC/Kept/1.0.2/Events/EventLanguages/Pack_Language_EN.txt"];
  assert.deepEqual(partitionOrphans(orphans, sources), { prune: orphans, withheld: [] });
});

test("main-pack orphans are never withheld (guarded upstream by discovery)", () => {
  const orphans = ["Weapon_language.txt", "EncyclopediaAssets/Mingyu.tsv"];
  assert.deepEqual(partitionOrphans(orphans, []), { prune: orphans, withheld: [] });
});

test("each empty family is withheld independently", () => {
  const orphans = [
    "Event_Languages/Taiwu_EventPackage_A_Language_EN.txt",
    "bundle-src/Language_EventOptionTips/EventOptionTips_EN.txt",
    "Removed_language.txt",
  ];
  const sources = ["Accessory_language.txt"];
  assert.deepEqual(partitionOrphans(orphans, sources), {
    prune: ["Removed_language.txt"],
    withheld: [
      {
        prefix: "Event_Languages/",
        keys: ["Event_Languages/Taiwu_EventPackage_A_Language_EN.txt"],
      },
      {
        prefix: "bundle-src/Language_EventOptionTips/",
        keys: ["bundle-src/Language_EventOptionTips/EventOptionTips_EN.txt"],
      },
    ],
  });
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
