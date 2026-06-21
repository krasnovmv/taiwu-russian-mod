import assert from "node:assert/strict";
import { test } from "node:test";

import type { AlignedFile } from "../src/align/bilingual.js";
import { GLOSSARY_VERSION } from "../src/config/glossary.js";
import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../src/model/tm.js";
import { srcHash } from "../src/tm/hash.js";
import { reconcile } from "../src/tm/sync.js";

function aligned(units: { key: string; en: string; cn: string | null }[]): AlignedFile {
  return {
    file: "Demo.txt",
    units,
    onlyEn: units.filter((u) => u.cn === null).map((u) => u.key),
    onlyCn: [],
    warnings: [],
  };
}

function unit(en: string, ru: string | null, status: TmUnit["status"]): TmUnit {
  return {
    en,
    cn: null,
    ru,
    status,
    srcHash: srcHash(en, GLOSSARY_VERSION),
    engine: ru ? "yandex" : null,
    updatedAt: null,
  };
}

function tm(units: Record<string, TmUnit>): TmFile {
  return {
    schemaVersion: TM_SCHEMA_VERSION,
    file: "Demo.txt",
    glossaryVersion: GLOSSARY_VERSION,
    units,
  };
}

test("adds new keys as pending", () => {
  const { tm: out, result } = reconcile(
    "Demo.txt",
    aligned([
      { key: "A", en: "alpha", cn: "甲" },
      { key: "B", en: "bravo", cn: "乙" },
    ]),
    tm({ A: unit("alpha", "альфа", "machine") }),
  );
  assert.equal(result.added, 1);
  assert.equal(out.units["B"]!.status, "pending");
  assert.equal(out.units["B"]!.ru, null);
});

test("drops removed keys", () => {
  const { result, tm: out } = reconcile(
    "Demo.txt",
    aligned([{ key: "A", en: "alpha", cn: null }]),
    tm({ A: unit("alpha", "альфа", "machine"), GONE: unit("x", "икс", "machine") }),
  );
  assert.equal(result.removed, 1);
  assert.ok(!("GONE" in out.units));
});

test("flags drifted machine vs reviewed/locked, preserves ru", () => {
  const { result, tm: out } = reconcile(
    "Demo.txt",
    aligned([
      { key: "M", en: "NEW english", cn: null },
      { key: "R", en: "NEW english", cn: null },
    ]),
    tm({
      M: unit("old english", "машинный", "machine"),
      R: unit("old english", "ревью", "reviewed"),
    }),
  );
  assert.equal(result.driftedMachine, 1);
  assert.equal(result.driftedReviewed, 1);
  // Translations are preserved; drift is only reported.
  assert.equal(out.units["M"]!.ru, "машинный");
  assert.equal(out.units["R"]!.ru, "ревью");
  assert.equal(out.units["R"]!.status, "reviewed");
});

test("refreshes CN reference and source for pending units", () => {
  const { tm: out } = reconcile(
    "Demo.txt",
    aligned([{ key: "P", en: "fresh en", cn: "新" }]),
    tm({ P: unit("old en", null, "pending") }),
  );
  assert.equal(out.units["P"]!.en, "fresh en");
  assert.equal(out.units["P"]!.cn, "新");
  assert.equal(out.units["P"]!.srcHash, srcHash("fresh en", GLOSSARY_VERSION));
});

test("syncFile is a no-op when a file has no TM yet", async () => {
  const { syncFile } = await import("../src/tm/sync.js");
  // A synthetic name with no `tm/<file>.json`: syncFile returns the no-TM result
  // before it ever reads the source, so this stays true regardless of which real
  // files have since been translated.
  const r = await syncFile("__nonexistent_no_tm__.txt", { dryRun: true });
  assert.equal(r.hadTm, false);
  assert.equal(r.total, 0);
});
