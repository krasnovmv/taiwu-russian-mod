/**
 * CN-only keys: strings that exist in the CN pack but not in EN (newer game
 * text the English pack hasn't caught up to). They must still be extracted,
 * translated from Chinese, and appended to the output on apply.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { pairedTxtAdapter } from "../src/formats/paired-txt-adapter.js";
import { buildTranslatedContent } from "../src/formats/paired-txt-build.js";

const EN = "Name_0\nIron Ring\nName_1\nSteel Abacus\n\n";
// CN has the same two keys plus one extra the EN pack lacks.
const CN = "Name_0\n铁戒指\nName_1\n钢算盘\nLK_New_Tip\n未至此地\n\n";

test("extract emits CN-only keys as zh-source units (Chinese as source text)", () => {
  const { units, onlyCn } = pairedTxtAdapter.extract(EN, CN);
  assert.deepEqual(onlyCn, []); // nothing dropped anymore

  const extra = units.find((u) => u.key === "LK_New_Tip");
  assert.ok(extra, "CN-only key extracted as a unit");
  assert.equal(extra.en, "未至此地"); // source text is the Chinese
  assert.equal(extra.cn, null); // no separate reference (it would equal the source)
  assert.equal(extra.srcLang, "zh");

  // Normal EN units keep the EN→CN shape and no srcLang.
  const normal = units.find((u) => u.key === "Name_0")!;
  assert.equal(normal.en, "Iron Ring");
  assert.equal(normal.cn, "铁戒指");
  assert.equal(normal.srcLang, undefined);
});

test("apply appends a translated CN-only key before the trailing blank line", () => {
  const translations = new Map([
    ["Name_0", "Железное кольцо"],
    ["LK_New_Tip", "Вы здесь не были"],
  ]);
  const r = buildTranslatedContent(EN, translations);
  assert.equal(r.guardOk, true, r.guardError ?? "guard failed");
  assert.equal(r.applied, 2); // one replaced value + one appended pair
  assert.equal(
    r.content,
    "Name_0\nЖелезное кольцо\nName_1\nSteel Abacus\nLK_New_Tip\nВы здесь не были\n\n",
  );
});

test("appended CN-only key keeps strict alternation (re-parses cleanly)", () => {
  const r = buildTranslatedContent(EN, new Map([["LK_New_Tip", "Текст"]]));
  assert.equal(r.guardOk, true, r.guardError ?? "guard failed");
  const re = pairedTxtAdapter.extract(r.content, null);
  assert.ok(re.warnings.length === 0, `unexpected warnings: ${re.warnings.join("; ")}`);
  assert.ok(re.units.some((u) => u.key === "LK_New_Tip"));
});

test("apply appends even when the EN file has no trailing blank line", () => {
  const enNoBlank = "Name_0\nIron Ring\n";
  const r = buildTranslatedContent(enNoBlank, new Map([["LK_New_Tip", "Текст"]]));
  assert.equal(r.guardOk, true, r.guardError ?? "guard failed");
  assert.equal(r.content, "Name_0\nIron Ring\nLK_New_Tip\nТекст\n");
});

test("a CN-only translation with a real newline is refused, not appended", () => {
  const r = buildTranslatedContent(EN, new Map([["LK_New_Tip", "две\nстроки"]]));
  assert.equal(r.applied, 0);
  assert.equal(r.unsafe, 1);
  assert.deepEqual(r.unsafeKeys, ["LK_New_Tip"]);
  assert.equal(r.content, EN); // unchanged
  assert.equal(r.guardOk, true);
});
