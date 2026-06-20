import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyFile } from "../src/apply/apply.js";
import { writeFileAtomic } from "../src/apply/fs.js";
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
