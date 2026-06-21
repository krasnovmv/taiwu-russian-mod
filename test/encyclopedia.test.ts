import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encyclopediaContentAdapter as content,
  encyclopediaReferenceAdapter as reference,
} from "../src/formats/encyclopedia.js";

// One realistic Content row: breadcrumb display (c0–c3) + body (c6) are
// translatable; the level enum (c7), table ref (c11) and node-id anchor (c12)
// are stable Chinese identifiers.
const CONTENT_ROW =
  "Adventure\tCricket\tCricket Hunt\tCatch Spot\t\t\t{0}\t高级\t\t\t\t{表Buzhuodian}\t游历-促织-捕捉促织-捕捉点10\n\n";

// One Reference table row: c0–c3 stable keys, c4 a {Title,…} field list, c5 title.
const REFERENCE_ROW =
  "表Buzhuodian\t表\tBuzhuodian\t{0}\t{Catch Spot,Cyan Cricket,Yellow Cricket}\tCatch Spot Overview\n\n";

test("content: extracts only breadcrumb + body, never identifiers", () => {
  const { units } = content.extract(CONTENT_ROW, null);
  assert.deepEqual(
    units.map((u) => u.key),
    ["r0c0", "r0c1", "r0c2", "r0c3"],
  );
  // c6 here is the bare {0} token (no letters) → skipped; c7/c11/c12 never emitted.
  assert.equal(
    units.some((u) => u.key === "r0c12" || u.key === "r0c11" || u.key === "r0c7"),
    false,
  );
});

test("content: body prose in c6 is extracted", () => {
  const row = "Home\t\t\t\t\t\tWelcome to Taiwupedia.\t初级\t\t\t\t\t主页\n\n";
  const { units } = content.extract(row, null);
  assert.equal(units.find((u) => u.key === "r0c6")?.en, "Welcome to Taiwupedia.");
});

test("content: identity apply is byte-exact", () => {
  const { units } = content.extract(CONTENT_ROW, null);
  const out = content.apply(CONTENT_ROW, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
  assert.equal(out.content, CONTENT_ROW);
});

test("content: translates breadcrumb, keeps anchor/enum/ref untouched", () => {
  const out = content.apply(
    CONTENT_ROW,
    new Map([
      ["r0c0", "Странствия"],
      ["r0c3", "Место ловли"],
    ]),
  );
  assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
  assert.equal(out.applied, 2);
  assert.match(out.content, /^Странствия\tCricket\tCricket Hunt\tМесто ловли\t/);
  assert.match(out.content, /\t高级\t/); // level enum intact
  assert.match(out.content, /\t\{表Buzhuodian\}\t/); // table ref intact
  assert.match(out.content, /\t游历-促织-捕捉促织-捕捉点10\n/); // node anchor intact
});

test("content: guard rejects a translation forged into a stable column", () => {
  // Simulate an engine that translated the Chinese node-id anchor (c12).
  const out = content.apply(CONTENT_ROW, new Map([["r0c12", "perevod"]]));
  // c12 is not a translatable column, so the map entry is simply ignored and the
  // file is byte-exact — the anchor can never be written in the first place.
  assert.equal(out.guardOk, true);
  assert.equal(out.content, CONTENT_ROW);
});

test("reference: extracts c4 field list per element + c5 title", () => {
  const { units } = reference.extract(REFERENCE_ROW, null);
  assert.deepEqual(
    units.map((u) => u.key),
    ["r0c4e0", "r0c4e1", "r0c4e2", "r0c5"],
  );
  assert.equal(units[0]?.en, "Catch Spot");
  assert.equal(units.find((u) => u.key === "r0c5")?.en, "Catch Spot Overview");
});

test("reference: stable keys c0–c3 never extracted", () => {
  const { units } = reference.extract(REFERENCE_ROW, null);
  assert.equal(
    units.some((u) => /^r0c[0-3](e|$)/.test(u.key)),
    false,
  );
});

test("reference: identity apply is byte-exact", () => {
  const { units } = reference.extract(REFERENCE_ROW, null);
  const out = reference.apply(REFERENCE_ROW, new Map(units.map((u) => [u.key, u.en])));
  assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
  assert.equal(out.content, REFERENCE_ROW);
});

test("reference: c4 elements reassemble with the same comma count", () => {
  const out = reference.apply(
    REFERENCE_ROW,
    new Map([
      ["r0c4e0", "Место ловли"],
      ["r0c4e2", "Жёлтый сверчок"],
      ["r0c5", "Обзор мест ловли"],
    ]),
  );
  assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
  assert.equal(out.applied, 3);
  assert.match(
    out.content,
    /\t\{Место ловли,Cyan Cricket,Жёлтый сверчок\}\tОбзор мест ловли\n/,
  );
  // c0–c3 stable identifiers intact.
  assert.match(out.content, /^表Buzhuodian\t表\tBuzhuodian\t\{0\}\t/);
});

test("reference: in-field comma in a c4 element is escaped, not refused", () => {
  // A Russian translation legitimately containing a comma must survive as one
  // field (escaped to ,), matching the game's own convention — without it
  // the field would split and break the grid.
  const out = reference.apply(REFERENCE_ROW, new Map([["r0c4e0", "Место, ловли"]]));
  assert.equal(out.guardOk, true, out.guardError ?? "guard failed");
  assert.equal(out.applied, 1);
  assert.equal(out.unsafe, 0);
  assert.match(out.content, /\t\{Место\\u002c ловли,Cyan Cricket,Yellow Cricket\}\t/);
  // Field count (literal commas) is unchanged: still two separators.
  const c4 = out.content.split("\n")[0]!.split("\t")[4]!;
  assert.equal((c4.match(/,/g) ?? []).length, 2);
});

test("reference: refuses a c4 element containing a brace (wrapper hazard)", () => {
  const out = reference.apply(REFERENCE_ROW, new Map([["r0c4e0", "a}b"]]));
  assert.equal(out.applied, 0);
  assert.equal(out.unsafe, 1);
  assert.deepEqual(out.unsafeKeys, ["r0c4e0"]);
  assert.equal(out.content, REFERENCE_ROW);
});
