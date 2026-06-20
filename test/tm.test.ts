import assert from "node:assert/strict";
import { test } from "node:test";

import type { AlignedFile } from "../src/align/bilingual.js";
import type { TmFile } from "../src/model/tm.js";
import { TM_SCHEMA_VERSION } from "../src/model/tm.js";
import { computeCoverage } from "../src/tm/coverage.js";
import { srcHash } from "../src/tm/hash.js";
import { serializeTm } from "../src/tm/store.js";

test("srcHash is deterministic and sensitive to source and glossary version", () => {
  assert.equal(srcHash("Iron Ring", 0), srcHash("Iron Ring", 0));
  assert.notEqual(srcHash("Iron Ring", 0), srcHash("Steel Ring", 0));
  assert.notEqual(srcHash("Iron Ring", 0), srcHash("Iron Ring", 1));
  assert.match(srcHash("x", 0), /^[0-9a-f]{16}$/);
});

test("serializeTm is canonical: 2-space indent, LF, trailing newline", () => {
  const tm: TmFile = {
    schemaVersion: TM_SCHEMA_VERSION,
    file: "Demo.txt",
    glossaryVersion: 0,
    units: {
      Name_0: {
        en: "Iron Ring",
        cn: "铁指环",
        ru: null,
        status: "pending",
        srcHash: "abc",
        engine: null,
        updatedAt: null,
      },
    },
  };
  const text = serializeTm(tm);
  assert.ok(text.endsWith("\n"));
  assert.ok(!text.includes("\r"));
  assert.ok(text.includes('\n  "file": "Demo.txt"'));
  assert.deepEqual(JSON.parse(text), tm); // round-trips through JSON
});

test("computeCoverage classifies translated / stale / pending", () => {
  const aligned: AlignedFile = {
    file: "Demo.txt",
    units: [
      { key: "A", en: "alpha", cn: "甲" },
      { key: "B", en: "bravo", cn: "乙" },
      { key: "C", en: "charlie", cn: null },
    ],
    onlyEn: ["C"],
    onlyCn: ["Z"],
    warnings: [],
  };
  const tm: TmFile = {
    schemaVersion: TM_SCHEMA_VERSION,
    file: "Demo.txt",
    glossaryVersion: 0,
    units: {
      A: {
        en: "alpha",
        cn: "甲",
        ru: "альфа",
        status: "machine",
        srcHash: srcHash("alpha", 0),
        engine: "yandex",
        updatedAt: null,
      },
      B: {
        en: "OLD",
        cn: "乙",
        ru: "браво",
        status: "reviewed",
        srcHash: srcHash("OLD", 0),
        engine: "yandex",
        updatedAt: null,
      },
      // C absent -> pending
    },
  };
  const cov = computeCoverage(aligned, tm);
  assert.equal(cov.total, 3);
  assert.equal(cov.translated, 1); // A matches current hash
  assert.equal(cov.stale, 1); // B's source drifted
  assert.equal(cov.pending, 1); // C
  assert.equal(cov.pendingChars, "charlie".length);
  assert.equal(cov.onlyEn, 1);
  assert.equal(cov.onlyCn, 1);
});

test("computeCoverage with no TM marks everything pending", () => {
  const aligned: AlignedFile = {
    file: "Demo.txt",
    units: [{ key: "A", en: "alpha", cn: "甲" }],
    onlyEn: [],
    onlyCn: [],
    warnings: [],
  };
  const cov = computeCoverage(aligned, null);
  assert.equal(cov.pending, 1);
  assert.equal(cov.translated, 0);
});
