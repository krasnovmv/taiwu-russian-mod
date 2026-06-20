import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyFile } from "../src/apply/apply.js";
import { ensureBackup, writeFileAtomic } from "../src/apply/fs.js";
import { TM_SCHEMA_VERSION, type TmFile } from "../src/model/tm.js";

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "taiwu-apply-"));
}

test("writeFileAtomic writes content and leaves no temp file", async () => {
  const dir = await tmpDir();
  const file = path.join(dir, "x.txt");
  await writeFileAtomic(file, "hello");
  assert.equal(await readFile(file, "utf8"), "hello");
  await assert.rejects(stat(path.join(dir, "x.txt.tmp")));
});

test("ensureBackup copies once, then is a no-op", async () => {
  const src = await tmpDir();
  const backup = await tmpDir();
  await writeFile(path.join(src, "a.txt"), "original");

  assert.equal(await ensureBackup("a.txt", src, backup), true);
  assert.equal(await readFile(path.join(backup, "a.txt"), "utf8"), "original");

  // Mutate source, backup must stay pristine and not be overwritten.
  await writeFile(path.join(src, "a.txt"), "changed");
  assert.equal(await ensureBackup("a.txt", src, backup), false);
  assert.equal(await readFile(path.join(backup, "a.txt"), "utf8"), "original");
});

test("applyFile backs up, then writes translated values in place", async () => {
  const src = await tmpDir();
  const backup = await tmpDir();
  const file = "Demo.txt";
  const original = "Name_0\nIron Ring\n\n";
  await writeFile(path.join(src, file), original);

  const tm: TmFile = {
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
    },
  };

  const r = await applyFile(file, { srcDir: src, backupDir: backup, tm });
  assert.equal(r.written, true);
  assert.equal(r.applied, 1);

  // Game file rewritten with the RU value...
  assert.equal(await readFile(path.join(src, file), "utf8"), "Name_0\nЖелезное кольцо\n\n");
  // ...and the pristine original preserved in the backup.
  assert.equal(await readFile(path.join(backup, file), "utf8"), original);
});

test("applyFile dry-run writes nothing but reports applied count", async () => {
  const src = await tmpDir();
  const backup = await tmpDir();
  const file = "Demo.txt";
  const original = "Name_0\nIron Ring\n\n";
  await writeFile(path.join(src, file), original);

  const tm: TmFile = {
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
    },
  };

  const r = await applyFile(file, { srcDir: src, backupDir: backup, tm, dryRun: true });
  assert.equal(r.written, false);
  assert.equal(r.applied, 1);
  assert.equal(await readFile(path.join(src, file), "utf8"), original); // untouched
});
