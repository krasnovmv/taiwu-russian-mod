import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyFile } from "../src/apply/apply.js";
import { writeFileAtomic } from "../src/util/fs.js";
import { TM_SCHEMA_VERSION, type TmFile } from "../src/model/tm.js";

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "taiwu-apply-"));
}

function tmWith(file: string, ru: string): TmFile {
  return {
    schemaVersion: TM_SCHEMA_VERSION,
    file,
    glossaryVersion: 0,
    units: {
      Name_0: {
        en: "Iron Ring",
        cn: null,
        ru,
        status: "machine",
        srcHash: "x",
        engine: "mock",
        updatedAt: null,
      },
    },
  };
}

test("writeFileAtomic creates dirs and leaves no temp file", async () => {
  const dir = await tmpDir();
  const file = path.join(dir, "nested", "x.txt");
  await writeFileAtomic(file, "hello");
  assert.equal(await readFile(file, "utf8"), "hello");
  await assert.rejects(stat(`${file}.tmp`));
});

test("applyFile writes RU into outDir and leaves the source untouched", async () => {
  const src = await tmpDir();
  const out = await tmpDir();
  const file = "Demo.txt";
  const original = "Name_0\nIron Ring\n\n";
  await writeFile(path.join(src, file), original);

  const r = await applyFile(file, {
    srcDir: src,
    outDir: out,
    tm: tmWith(file, "Железное кольцо"),
  });
  assert.equal(r.written, true);
  assert.equal(r.applied, 1);

  assert.equal(await readFile(path.join(out, file), "utf8"), "Name_0\nЖелезное кольцо\n\n");
  assert.equal(await readFile(path.join(src, file), "utf8"), original); // source intact
});

test("applyFile mirrors English when there is no translation (complete pack)", async () => {
  const src = await tmpDir();
  const out = await tmpDir();
  const file = "Demo.txt";
  const original = "Name_0\nIron Ring\n\n";
  await writeFile(path.join(src, file), original);

  const r = await applyFile(file, { srcDir: src, outDir: out, tm: null });
  assert.equal(r.written, true);
  assert.equal(r.applied, 0);
  assert.equal(await readFile(path.join(out, file), "utf8"), original); // English copy
});

/** TM with a short machine unit and a long unit of the given status. */
function tmTwo(file: string, longStatus: "machine" | "reviewed"): TmFile {
  return {
    schemaVersion: TM_SCHEMA_VERSION,
    file,
    glossaryVersion: 0,
    units: {
      Name_0: {
        en: "Iron Ring",
        cn: null,
        ru: "Железное кольцо",
        status: "machine",
        srcHash: "x",
        engine: "mock",
        updatedAt: null,
      },
      Desc_0: {
        en: "A very long descriptive sentence here",
        cn: null,
        ru: "Длинное описание",
        status: longStatus,
        srcHash: "x",
        engine: "mock",
        updatedAt: null,
      },
    },
  };
}

const TWO_SRC = "Name_0\nIron Ring\nDesc_0\nA very long descriptive sentence here\n\n";

test("lowering the cap stops applying now-too-long machine units (English kept)", async () => {
  const src = await tmpDir();
  const file = "Demo.txt";
  await writeFile(path.join(src, file), TWO_SRC);

  // High cap: both the short name and the long description are applied.
  const big = await applyFile(file, {
    srcDir: src,
    outDir: await tmpDir(),
    tm: tmTwo(file, "machine"),
    maxLen: 40,
  });
  assert.equal(big.applied, 2);

  // Low cap: the long unit falls out of scope -> English kept, short stays RU.
  const out = await tmpDir();
  const small = await applyFile(file, {
    srcDir: src,
    outDir: out,
    tm: tmTwo(file, "machine"),
    maxLen: 10,
  });
  assert.equal(small.applied, 1);
  const built = await readFile(path.join(out, file), "utf8");
  assert.ok(built.includes("Железное кольцо"), "short unit still translated");
  assert.ok(
    built.includes("A very long descriptive sentence here"),
    "long unit reverts to English",
  );
  assert.ok(
    !built.includes("Длинное описание"),
    "long machine RU is not applied under the low cap",
  );
});

test("reviewed/locked units are applied regardless of the cap", async () => {
  const src = await tmpDir();
  const out = await tmpDir();
  const file = "Demo.txt";
  await writeFile(path.join(src, file), TWO_SRC);

  // Same long unit, but human-reviewed: applied even under a tiny cap.
  const r = await applyFile(file, {
    srcDir: src,
    outDir: out,
    tm: tmTwo(file, "reviewed"),
    maxLen: 10,
  });
  assert.equal(r.applied, 2);
  assert.ok((await readFile(path.join(out, file), "utf8")).includes("Длинное описание"));
});

test("applyFile dry-run writes nothing", async () => {
  const src = await tmpDir();
  const out = await tmpDir();
  const file = "Demo.txt";
  await writeFile(path.join(src, file), "Name_0\nIron Ring\n\n");

  const r = await applyFile(file, {
    srcDir: src,
    outDir: out,
    tm: tmWith(file, "Железное кольцо"),
    dryRun: true,
  });
  assert.equal(r.written, false);
  assert.equal(r.applied, 1);
  await assert.rejects(stat(path.join(out, file)));
});
