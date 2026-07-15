import assert from "node:assert/strict";
import test from "node:test";

import { judgeHash, selectJudgeWork } from "../src/judge/judge.js";
import { buildUserMessage, parseVerdict, shouldFix, type Verdict } from "../src/judge/prompt.js";
import { needsTranslation } from "../src/translate/pipeline.js";
import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../src/model/tm.js";
import { checkTranslation, glossaryMisses } from "../src/validate/qa.js";
import { matchGlossary } from "../src/glossary/match.js";

const unit = (over: Partial<TmUnit> = {}): TmUnit => ({
  en: "A blade of the Wandering Sect.",
  cn: "游侠派的刀。",
  ru: "Клинок секты странников.",
  status: "machine",
  srcHash: "h",
  engine: "yandex",
  updatedAt: null,
  ...over,
});

const tmOf = (units: Record<string, TmUnit>): TmFile => ({
  schemaVersion: TM_SCHEMA_VERSION,
  file: "Language_EN/Skill_language.txt",
  glossaryVersion: 1,
  units,
});

/** Every unit's source is current, so nothing is skipped as drifted. */
const currentHash = (): string => "h";

test("selectJudgeWork skips pending, human, neutral and drifted units", () => {
  const tm = tmOf({
    machine: unit(),
    pending: unit({ ru: null, status: "pending" }),
    reviewed: unit({ status: "reviewed" }),
    locked: unit({ status: "locked" }),
    neutral: unit({ engine: "neutral", ru: "ID_1", en: "ID_1", cn: "ID_1" }),
    drifted: unit({ srcHash: "old" }),
  });
  const keys = selectJudgeWork(tm, currentHash).map((c) => c.key);
  assert.deepEqual(keys, ["machine"]);
});

test("selectJudgeWork skips units whose verdict still stands, and --force overrides", () => {
  const judged = unit({ judgeHash: judgeHash("h", "游侠派的刀。") });
  const tm = tmOf({ judged });
  assert.deepEqual(selectJudgeWork(tm, currentHash), []);
  assert.deepEqual(
    selectJudgeWork(tm, currentHash, { force: true }).map((c) => c.key),
    ["judged"],
  );
});

test("a verdict is invalidated by a CN change (the EN and glossary ride in srcHash)", () => {
  // Same unit, same EN → same srcHash, but the Chinese reference moved: the judge
  // ruled on a meaning that no longer holds, so the unit must come back.
  const stale = unit({ judgeHash: judgeHash("h", "旧的中文"), cn: "新的中文" });
  assert.deepEqual(
    selectJudgeWork(tmOf({ stale }), currentHash).map((c) => c.key),
    ["stale"],
  );
  assert.notEqual(judgeHash("h", "a"), judgeHash("h", "b"));
  assert.notEqual(judgeHash("h1", "a"), judgeHash("h2", "a"));
});

test("selectJudgeWork honours the length window and the limit", () => {
  const tm = tmOf({
    short: unit({ en: "Ok" }),
    long: unit({ en: "x".repeat(200) }),
    also: unit({ en: "y".repeat(200) }),
  });
  assert.deepEqual(
    selectJudgeWork(tm, currentHash, { minLen: 100 }).map((c) => c.key),
    ["long", "also"],
  );
  assert.deepEqual(
    selectJudgeWork(tm, currentHash, { maxLen: 10 }).map((c) => c.key),
    ["short"],
  );
  assert.equal(selectJudgeWork(tm, currentHash, { limit: 2 }).length, 2);
});

test("a judged unit survives a cache rebuild but not a source or engine change", () => {
  const u = unit({ status: "judged", ru: "исправлено" });
  // refreshCached (`rebuild-tm`) must not overwrite the judge's fix with the raw
  // machine translation the cache still holds.
  assert.equal(needsTranslation(u, "h", "yandex", true), false);
  // A real source/engine change invalidates the text the fix was made on.
  assert.equal(needsTranslation(u, "h2", "yandex", true), true);
  assert.equal(needsTranslation(u, "h", "lmstudio", true), true);
});

test("parseVerdict tolerates a model that wraps its JSON in prose or a fence", () => {
  assert.deepEqual(parseVerdict('{"errors":[],"ru":""}'), { errors: [], ru: "" });
  assert.deepEqual(
    parseVerdict(
      'Here you go:\n```json\n{"errors":[{"category":"terminology","severity":"major",' +
        '"explanation":"glossary term ignored"}],"ru":" Клинок "}\n```',
    ),
    {
      errors: [
        { category: "terminology", severity: "major", explanation: "glossary term ignored" },
      ],
      ru: "Клинок",
    },
  );
  // Unparseable output must never be read as a rewrite — it leaves the unit alone.
  assert.deepEqual(parseVerdict("I think it is fine, honestly"), { errors: [], ru: "" });
  assert.deepEqual(parseVerdict("{ broken"), { errors: [], ru: "" });
  // A malformed error entry (bogus severity) is dropped, not trusted.
  assert.deepEqual(
    parseVerdict('{"errors":[{"category":"x","severity":"huge"}],"ru":"Х"}').errors,
    [],
  );
});

test("only a major/critical error rewrites a translation — minor ones never do", () => {
  const err = (severity: string): Verdict["errors"] => [
    {
      category: "fluency/grammar",
      severity: severity as Verdict["errors"][number]["severity"],
      explanation: "",
    },
  ];
  // The whole point of the MQM threshold: a clumsy-but-clear phrasing is left alone.
  assert.equal(shouldFix({ errors: err("minor"), ru: "Новый перевод" }), false);
  assert.equal(shouldFix({ errors: [], ru: "Новый перевод" }), false); // no error → no rewrite
  assert.equal(shouldFix({ errors: err("major"), ru: "Новый перевод" }), true);
  assert.equal(shouldFix({ errors: err("critical"), ru: "Новый перевод" }), true);
  // A serious error but no correction offered: nothing to write.
  assert.equal(shouldFix({ errors: err("critical"), ru: "" }), false);
  // Mixed severities: the worst one decides.
  assert.equal(
    shouldFix({ errors: [...err("minor"), ...err("major")], ru: "Новый перевод" }),
    true,
  );
});

test("a rewrite is gated by the same checks `npm run validate` runs", () => {
  const en = "Restores {0} points.\\nDone.";
  // What the judge is allowed to write.
  assert.deepEqual(checkTranslation(en, "Восстанавливает {0} очков.\\nГотово."), []);
  // Dropped placeholder, mangled escape, leftover English, empty — all rejected.
  const kinds = (ru: string): string[] => checkTranslation(en, ru).map((i) => i.kind);
  assert.ok(kinds("Восстанавливает очков.\\nГотово.").includes("markup-mismatch"));
  assert.ok(kinds("Восстанавливает {0} очков.\\Готово.").includes("escape-mismatch"));
  assert.ok(kinds("Восстанавливает {0} очков.\nГотово.").includes("newline-hazard"));
  assert.ok(
    checkTranslation("Iron Ring", "")
      .map((i) => i.kind)
      .includes("empty-output"),
  );
  assert.ok(
    checkTranslation("Iron Ring", "Iron Ring")
      .map((i) => i.kind)
      .includes("untranslated"),
  );
});

test("a rewrite that leaves Latin in the Russian is rejected", () => {
  const kinds = (en: string, ru: string): string[] => checkTranslation(en, ru).map((i) => i.kind);
  // A mixed-script corruption (`lack` + `еев`) the model produced in a real run.
  assert.ok(kinds("Destroy minions", "Уничтожать lackеев").includes("latin-in-russian"));
  // A whole English word left untranslated.
  assert.ok(kinds("Deal DMG", "Нанести DMG урона").includes("latin-in-russian"));
  // Latin INSIDE markup is not the translation's Latin — a colour tag is fine.
  assert.deepEqual(
    kinds(
      "<color=#FiveElementType_Jingang>Metal</color>",
      "<color=#FiveElementType_Jingang>Металл</color>",
    ),
    [],
  );
  // Clean Russian passes.
  assert.deepEqual(kinds("Iron Ring", "Железное кольцо"), []);
  // A pinyin name carried through verbatim is `untranslated`, not double-flagged.
  assert.deepEqual(kinds("Zhang Fei", "Zhang Fei"), ["untranslated"]);
});

test("a rewrite that ignores a mandated glossary term is rejected", () => {
  const g = new Map([["divine loong", "божественный лун"]]);
  const matches = matchGlossary("Pass the Divine Loong trial", g);
  // Judge swapped the mandated лун for дракон — caught by the head-noun stem.
  assert.deepEqual(
    glossaryMisses("Испытание Божественного Дракона", matches).map((i) => i.kind),
    ["glossary-miss"],
  );
  // Any grammatical form of the right word passes (лун → луна, declined).
  assert.deepEqual(glossaryMisses("Испытание божественного луна", matches), []);
  // No glossary term in the source → nothing to enforce.
  assert.deepEqual(glossaryMisses("что угодно", matchGlossary("plain text", g)), []);
});

test("the user message carries the file, the key, all three texts and the glossary", () => {
  const msg = buildUserMessage(
    {
      file: "Language_EN/Skill_language.txt",
      key: "1_2",
      en: "Inner power",
      cn: "内力",
      ru: "Сила",
    },
    // Glossary keys are stored lower-cased (see glossary/match.ts).
    new Map([["inner power", "внутренняя сила"]]),
  );
  assert.match(msg, /FILE: Language_EN\/Skill_language\.txt/);
  assert.match(msg, /KEY: 1_2/);
  assert.match(msg, /Inner power/);
  assert.match(msg, /内力/);
  assert.match(msg, /Сила/);
  assert.match(msg, /GLOSSARY[\s\S]*inner power → внутренняя сила/);
});

test("the MACHINE block shows the engine's wording a previous judge rewrote", () => {
  const ctx = {
    file: "f.txt",
    key: "k",
    en: "Hexus Mirror",
    cn: "六甲玄鉴",
    ru: "Зеркало Шестицзя", // an earlier judge's rewrite
    machine: "Шестигранное зеркало", // what Yandex actually produced
  };
  const msg = buildUserMessage(ctx, new Map());
  assert.match(msg, /MACHINE \(the raw engine output[\s\S]*Шестигранное зеркало/);

  // An untouched machine translation must NOT get the block — it would just
  // repeat the RUSSIAN and invite the model to "compare" a string with itself.
  const same = buildUserMessage({ ...ctx, ru: ctx.machine }, new Map());
  assert.doesNotMatch(same, /MACHINE/);
  assert.doesNotMatch(buildUserMessage({ ...ctx, machine: null }, new Map()), /MACHINE/);
});

test("the CN block says so when the string has no Chinese original", () => {
  const msg = buildUserMessage(
    { file: "f.txt", key: "k", en: "Hello", cn: null, ru: "Привет" },
    new Map(),
  );
  assert.match(msg, /CHINESE: \(absent/);
});
