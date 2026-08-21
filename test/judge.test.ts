import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  judgeHash,
  judgeTm,
  selectJudgeWork,
  verdictKey,
  type JudgeOutcome,
} from "../src/judge/judge.js";
import { VerdictCache } from "../src/judge/verdict-cache.js";
import { buildUserMessage, parseVerdict, shouldFix, type Verdict } from "../src/judge/prompt.js";
import { needsTranslation } from "../src/translate/pipeline.js";
import { TM_SCHEMA_VERSION, type TmFile, type TmUnit } from "../src/model/tm.js";
import { checkTranslation, glossaryMisses } from "../src/validate/qa.js";
import { matchGlossary } from "../src/glossary/match.js";
import { makeSrcHasher } from "../src/tm/hash.js";
import type { ChatMessage } from "../src/engine/chat-client.js";

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
  // Unparseable output is a FAILED request, not a verdict: `null`, never an
  // empty annotation — that would stamp the unit "reviewed OK" unreviewed.
  assert.equal(parseVerdict("I think it is fine, honestly"), null);
  assert.equal(parseVerdict("{ broken"), null);
  // JSON truncated by the completion cap parses to nothing — also a failure.
  assert.equal(parseVerdict('{"errors":[{"category":"terminology","severity":"ma'), null);
  // A malformed error entry (bogus severity) is dropped, not trusted.
  assert.deepEqual(
    parseVerdict('{"errors":[{"category":"x","severity":"huge"}],"ru":"Х"}')?.errors,
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

test("a rewrite that leaves Chinese in the Russian is rejected", () => {
  const kinds = (en: string, ru: string): string[] => checkTranslation(en, ru).map((i) => i.kind);
  // A name the engine gave up on and left in hanzi.
  assert.ok(kinds("Hexagonal Mirror", "Зеркало 六甲").includes("chinese-in-russian"));
  // The CN reference copied in beside the Russian as a gloss.
  assert.ok(kinds("Wandering Sect", "Секта странников (游侠派)").includes("chinese-in-russian"));
  // A transliterated name is the correct rendering — no hanzi, nothing flagged.
  assert.deepEqual(kinds("Hexagonal Mirror", "Зеркало Шестицзя"), []);
  // A CN-sourced unit carried through verbatim is `untranslated`, not double-flagged.
  assert.deepEqual(kinds("六甲镜", "六甲镜"), ["untranslated"]);
});

test("a rewrite that drops a source special character is rejected", () => {
  const kinds = (en: string, ru: string): string[] => checkTranslation(en, ru).map((i) => i.kind);
  // The reported bug: EN wraps the tip in "quotes", the rewrite dropped them.
  assert.ok(
    kinds('"Cancel the [Protection] art."', "Отмени [Защита].").includes("special-char-loss"),
  );
  // Quotes kept → fine.
  assert.deepEqual(kinds('"Cancel it."', '"Отмени это."'), []);
  // A game-stat percent dropped is caught.
  assert.ok(kinds("Deals 50% damage", "Наносит 50 урона").includes("special-char-loss"));
  // `&` correctly rendered as the word «и» is NOT flagged (it is excluded).
  assert.deepEqual(kinds("Visit & Rest", "Посещение и отдых"), []);
  // An English apostrophe with no Russian form is NOT flagged.
  assert.deepEqual(kinds("the enemy's blade", "клинок врага"), []);
  // An escaped quote is the escape check's job, not double-flagged here.
  assert.deepEqual(kinds('Say \\"hi\\"', "Скажи привет"), ["escape-mismatch"]);
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

test("verdictKey groups by judge context and engine, ignoring the RU wording and status", () => {
  assert.equal(verdictKey("h", unit()), verdictKey("h", unit()));
  // A different source hash (EN/glossary), CN or engine is a different context.
  assert.notEqual(verdictKey("h", unit()), verdictKey("h2", unit()));
  assert.notEqual(verdictKey("h", unit()), verdictKey("h", unit({ cn: "别的" })));
  assert.notEqual(
    verdictKey("h", unit({ engine: "yandex" })),
    verdictKey("h", unit({ engine: "lmstudio" })),
  );
  // The RU text and the status do NOT split a group: for one engine the RU of a
  // given EN is single-valued in practice, and the group head's verdict stands
  // for all members.
  assert.equal(verdictKey("h", unit()), verdictKey("h", unit({ ru: "Другое" })));
  assert.equal(verdictKey("h", unit()), verdictKey("h", unit({ status: "judged" })));
});

/** In-memory judge run helpers: a real hasher (empty glossary) and a scripted client. */
const emptyGlossary = new Map<string, string>();
const realHash = makeSrcHasher(emptyGlossary);
const liveUnit = (en: string, ru: string, over: Partial<TmUnit> = {}): TmUnit => ({
  en,
  cn: `原文:${en}`,
  ru,
  status: "machine",
  srcHash: realHash(en),
  engine: "yandex",
  updatedAt: null,
  ...over,
});
const clientOf = (
  respond: (user: string) => string,
): { calls: string[]; chat: (messages: ChatMessage[]) => Promise<string> } => {
  const calls: string[] = [];
  return {
    calls,
    chat: (messages) => {
      const user = messages[1]?.content ?? "";
      calls.push(user);
      return Promise.resolve(respond(user));
    },
  };
};
const KEEP = '{"errors":[],"ru":""}';
const fixWith = (ru: string): string =>
  `{"errors":[{"category":"accuracy/mistranslation","severity":"major","explanation":"x"}],"ru":${JSON.stringify(ru)}}`;

test("judgeTm sends one request per identical context and fans the verdict out", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Adventure", "Приключение"),
    c: liveUnit("Sect", "Секта"),
  });
  const client = clientOf((user) => (user.includes("Adventure") ? fixWith("Странствие") : KEEP));

  const stats = await judgeTm(tm, client, emptyGlossary, { now: "T" });

  assert.equal(client.calls.length, 2); // one per group, not per unit
  assert.equal(stats.judged, 2);
  assert.equal(stats.fixed, 1);
  assert.equal(stats.ok, 1);
  assert.equal(stats.reused, 1); // the duplicate rode along for free
  // The rewrite reached BOTH duplicates; the singleton kept its text but is marked.
  for (const key of ["a", "b"] as const) {
    assert.equal(tm.units[key]?.ru, "Странствие");
    assert.equal(tm.units[key]?.status, "judged");
    assert.equal(tm.units[key]?.judgeHash, judgeHash(realHash("Adventure"), "原文:Adventure"));
  }
  assert.equal(tm.units.c?.ru, "Секта");
  assert.equal(tm.units.c?.judgeHash, judgeHash(realHash("Sect"), "原文:Sect"));
});

test("a shared memo settles duplicates across files without a request", async () => {
  const memo = new Map<string, JudgeOutcome>();
  const first = tmOf({ a: liveUnit("Adventure", "Приключение") });
  const second = tmOf({ z: liveUnit("Adventure", "Приключение") });
  const client = clientOf(() => fixWith("Странствие"));

  await judgeTm(first, client, emptyGlossary, { memo });
  const stats = await judgeTm(second, client, emptyGlossary, { memo });

  assert.equal(client.calls.length, 1);
  assert.equal(stats.judged, 0);
  assert.equal(stats.reused, 1);
  assert.equal(second.units.z?.ru, "Странствие");
  assert.equal(second.units.z?.status, "judged");
});

test("--force bypasses memo reads but still records the fresh verdict", async () => {
  const u = liveUnit("Adventure", "Приключение");
  const memo = new Map<string, JudgeOutcome>([
    [verdictKey(realHash("Adventure"), u), { kind: "fix", ru: "Из кеша" }],
  ]);
  const tm = tmOf({ a: u });
  const client = clientOf(() => KEEP);

  const stats = await judgeTm(tm, client, emptyGlossary, { memo, force: true });

  assert.equal(client.calls.length, 1); // asked the model despite the cached verdict
  assert.equal(stats.judged, 1);
  assert.equal(tm.units.a?.ru, "Приключение"); // fresh "keep" won, not the stale fix
  assert.deepEqual(memo.get(verdictKey(realHash("Adventure"), u)), { kind: "keep" });
});

test("VerdictCache round-trips outcomes through disk and compacts stale lines", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "taiwu-judge-cache-")), "judge.jsonl");
  const cache = await VerdictCache.open(file);
  cache.set("k1 yandex", { kind: "keep" });
  cache.set("k2 yandex", { kind: "fix", ru: "Текст" });
  await cache.flush();

  const reopened = await VerdictCache.open(file);
  assert.deepEqual(reopened.get("k1 yandex"), { kind: "keep" });
  assert.deepEqual(reopened.get("k2 yandex"), { kind: "fix", ru: "Текст" });
  assert.equal(reopened.get("unknown"), undefined);

  // A duplicate line (e.g. a --force overwrite) wins on reload and is compacted.
  await appendFile(file, `${JSON.stringify({ k: "k1 yandex", v: "Новый" })}\n`, "utf8");
  const compacted = await VerdictCache.open(file);
  assert.deepEqual(compacted.get("k1 yandex"), { kind: "fix", ru: "Новый" });
});

test("a QA-rejected fix marks and memoizes nothing — every duplicate stays retryable", async () => {
  const memo = new Map<string, JudgeOutcome>();
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Adventure", "Приключение"),
  });
  // The "fix" leaves Latin in the Russian, so the QA gate throws it away.
  const client = clientOf(() => fixWith("Adventure тур"));

  const stats = await judgeTm(tm, client, emptyGlossary, { memo });

  assert.equal(stats.rejected, 1);
  assert.equal(stats.fixed, 0);
  assert.equal(memo.size, 0);
  assert.equal(tm.units.a?.judgeHash, undefined);
  assert.equal(tm.units.b?.judgeHash, undefined);
  assert.equal(tm.units.a?.ru, "Приключение");
});

test("unparseable model output marks and memoizes nothing — the group stays retryable", async () => {
  const memo = new Map<string, JudgeOutcome>();
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Adventure", "Приключение"),
  });
  const client = clientOf(() => "Sure! The translation looks fine to me.");

  const stats = await judgeTm(tm, client, emptyGlossary, { memo });

  assert.equal(stats.errors, 1);
  assert.equal(stats.judged, 0);
  assert.equal(stats.ok, 0);
  assert.equal(memo.size, 0);
  assert.equal(tm.units.a?.judgeHash, undefined);
  assert.equal(tm.units.b?.judgeHash, undefined);
  assert.match(stats.problems[0]?.error ?? "", /unparseable/);
});

/** A client that records the WHOLE message array, so a conversation is visible. */
const sessionClientOf = (
  respond: (user: string) => string,
): { calls: ChatMessage[][]; chat: (messages: ChatMessage[]) => Promise<string> } => {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    chat: (messages) => {
      calls.push(messages.map((m) => ({ ...m })));
      return Promise.resolve(respond(messages[messages.length - 1]?.content ?? ""));
    },
  };
};
const usersOf = (call: ChatMessage[]): string[] =>
  call.filter((m) => m.role === "user").map((m) => m.content);

test("the default window keeps every request stateless", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
    c: liveUnit("Blade", "Клинок"),
  });
  const client = sessionClientOf(() => KEEP);

  await judgeTm(tm, client, emptyGlossary, { concurrency: 1 });

  // system + the one unit, exactly as before sessions existed.
  assert.deepEqual(
    client.calls.map((m) => m.length),
    [2, 2, 2],
  );
});

test("a session carries its earlier turns and restarts after the window", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
    c: liveUnit("Blade", "Клинок"),
    d: liveUnit("Mirror", "Зеркало"),
    e: liveUnit("Poison", "Яд"),
  });
  const client = sessionClientOf(() => KEEP);

  await judgeTm(tm, client, emptyGlossary, { concurrency: 1, sessionTurns: 3 });

  // Three turns in one conversation (2, 4, 6 messages), then a fresh one.
  assert.deepEqual(
    client.calls.map((m) => m.length),
    [2, 4, 6, 2, 4],
  );
  assert.deepEqual(
    client.calls[2]?.map((m) => m.role),
    ["system", "user", "assistant", "user", "assistant", "user"],
  );
  // The history is this lane's own earlier units, in order.
  assert.deepEqual(
    usersOf(client.calls[2] ?? []).map((u) => /ENGLISH:\n(\w+)/.exec(u)?.[1]),
    ["Adventure", "Sect", "Blade"],
  );
});

test("an answer the pipeline could not use is dropped from the conversation", async () => {
  // Unparseable output, then a rewrite QA rejects: neither may stay in the
  // history as an example of what the model is expected to return.
  for (const bad of ["Sure, it all looks fine to me.", fixWith("Adventure тур")]) {
    const tm = tmOf({
      a: liveUnit("Adventure", "Приключение"),
      b: liveUnit("Sect", "Секта"),
    });
    const client = sessionClientOf((user) => (user.includes("Adventure") ? bad : KEEP));

    await judgeTm(tm, client, emptyGlossary, { concurrency: 1, sessionTurns: 5 });

    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[1]?.length, 2); // the second unit starts clean
  }
});

test("concurrent lanes keep separate conversations", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
    c: liveUnit("Blade", "Клинок"),
    d: liveUnit("Mirror", "Зеркало"),
  });
  const client = sessionClientOf(() => KEEP);

  await judgeTm(tm, client, emptyGlossary, { concurrency: 2, sessionTurns: 4 });

  // Two lanes → two conversations, and a turn of one never lands in the other.
  assert.equal(client.calls.filter((m) => m.length === 2).length, 2);
  const withFirst = client.calls.filter((c) => usersOf(c).some((u) => u.includes("Adventure")));
  assert.ok(withFirst.length > 0);
  assert.ok(withFirst.every((c) => !usersOf(c).some((u) => u.includes("Sect"))));
});

test("the CN block says so when the string has no Chinese original", () => {
  const msg = buildUserMessage(
    { file: "f.txt", key: "k", en: "Hello", cn: null, ru: "Привет" },
    new Map(),
  );
  assert.match(msg, /CHINESE: \(absent/);
});
