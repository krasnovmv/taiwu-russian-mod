import assert from "node:assert/strict";
import { test } from "node:test";

import { alignFile } from "../src/align/bilingual.js";

/**
 * Integration check against the real game files: a small clean file must align
 * EN to CN by key, with CN references present and value indices recoverable.
 */
const SAMPLE = "Loong_language.txt";

test(`alignFile pairs EN with CN for ${SAMPLE}`, async () => {
  const aligned = await alignFile(SAMPLE);
  assert.ok(aligned.units.length > 0, "expected at least one unit");

  const withCn = aligned.units.filter((u) => u.cn !== null);
  assert.ok(withCn.length > 0, "expected CN references to be joined");

  for (const u of aligned.units) {
    assert.equal(typeof u.key, "string");
    assert.ok(u.key.length > 0);
    assert.equal(typeof u.en, "string");
  }
});

/**
 * The EN pack ships some values the developers never translated (the Chinese
 * original under an English key). Alignment must call those what they are, or the
 * pipeline reads EN==CN as "language-neutral" and copies hanzi into the Russian.
 */
test("a wholly Chinese EN value is labelled zh-source, not left as English", async () => {
  const aligned = await alignFile("Feast_language.txt");
  const han = /\p{Script=Han}/u;
  const untranslated = aligned.units.filter((u) => han.test(u.en) && !/[A-Za-z]/.test(u.en));
  assert.ok(untranslated.length > 0, "sample file must still ship an untranslated Chinese value");
  for (const u of untranslated) {
    assert.equal(u.srcLang, "zh", `${u.key}: Chinese source must be labelled zh`);
    assert.notEqual(u.cn, u.en, `${u.key}: a CN reference repeating the source must be dropped`);
  }
  // English values keep their EN→CN shape.
  assert.ok(aligned.units.filter((u) => !han.test(u.en)).every((u) => u.srcLang === undefined));
});

test("alignFile reports onlyEn/onlyCn as arrays", async () => {
  const aligned = await alignFile(SAMPLE);
  assert.ok(Array.isArray(aligned.onlyEn));
  assert.ok(Array.isArray(aligned.onlyCn));
});
