import assert from "node:assert/strict";
import { test } from "node:test";

import { alignFile } from "../src/align/bilingual.js";
import { applySourceFixes, SOURCE_FIXES } from "../src/config/source-fixes.js";
import type { SourceUnit } from "../src/formats/adapter.js";

test("applySourceFixes rewrites the configured field and leaves others alone", () => {
  const units: SourceUnit[] = [
    { key: "a/EventContent", en: "and <<Character/> smiled", cn: "只见<<Character/>端坐" },
    { key: "b/EventContent", en: "untouched", cn: null },
  ];
  const file = [...SOURCE_FIXES.keys()][0]!;
  // Use a synthetic fix table shape via the real applier: pick a real file id
  // but synthetic units — every configured fix should miss and warn.
  const warnings: string[] = [];
  const out = applySourceFixes(file, units, warnings);
  assert.equal(out[1], units[1], "unit without fixes passes through by reference");
  assert.ok(warnings.length > 0, "fixes that match no unit/substring must surface as warnings");
});

test("alignFile serves repaired EN/CN for the wedding double-bracket unit", async () => {
  const file = "Event_Languages/Taiwu_EventPackage_Adventure_Interact_Wedding_Language_EN.txt";
  const aligned = await alignFile(file);
  const unit = aligned.units.find(
    (u) => u.key === "a6d79d6f-e4c2-4f7f-990a-fe7f6e326148/EventContent",
  );
  assert.ok(unit, "unit present");
  assert.ok(!unit.en.includes("<<"), "EN doubled bracket repaired");
  assert.ok(!(unit.cn ?? "").includes("<<"), "CN doubled bracket repaired");
  assert.ok(unit.en.includes("<Character key=Character2 str=Name />"), "tag intact");
  // No stale-fix warnings for this file: every configured fix matched.
  const stale = aligned.warnings.filter((w) => w.includes("source fix"));
  assert.deepEqual(stale, []);
});

test("alignFile repairs the fused <NL> tag in the LoongDLC unit", async () => {
  const file = "Event_Languages/Taiwu_EventPackage_LoongDLC_Language_EN.txt";
  const aligned = await alignFile(file);
  const unit = aligned.units.find(
    (u) => u.key === "57c083e8-73db-4426-9320-cc07d5fc3189/EventContent",
  );
  assert.ok(unit, "unit present");
  assert.ok(unit.en.includes("<NL>Those who pass through"), "fused tag split");
  assert.ok(!unit.en.includes("<NLThose"), "defect gone");
});

test("alignFile repairs the truncated GenderObject tags in the Shixiang options", async () => {
  const file = "Event_Languages/Taiwu_EventPackage_SectMainStoryShixiang_Language_EN.txt";
  const aligned = await alignFile(file);
  for (const id of [
    "129ede5d-1a19-4a8c-b2e6-7f749cdf82d5",
    "29e9fb23-5f1a-406e-918e-89ba0f5382f1",
    "023d6836-1e9e-4175-9999-775329806013",
  ]) {
    const unit = aligned.units.find((u) => u.key === `${id}/Option_1`);
    assert.ok(unit, `${id}/Option_1 present`);
    assert.equal(unit.en, "(Cure <Character key=CharacterId str=GenderObject/>...)");
  }
  const stale = aligned.warnings.filter((w) => w.includes("source fix"));
  assert.deepEqual(stale, []);
});
