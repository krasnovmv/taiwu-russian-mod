import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  batchByCost,
  judgeHash,
  judgeTm,
  orderJudgeFiles,
  selectJudgeWork,
  verdictKey,
  type JudgeOutcome,
} from "../src/judge/judge.js";
import { VerdictCache } from "../src/judge/verdict-cache.js";
import {
  buildBatchMessage,
  buildUserMessage,
  parseBatchVerdict,
  shouldFix,
  type Verdict,
} from "../src/judge/prompt.js";
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

test("parseBatchVerdict tolerates a model that wraps its JSON in prose or a fence", () => {
  assert.deepEqual(parseBatchVerdict('{"units":[{"id":1,"errors":[],"ru":""}]}')?.get(1), {
    errors: [],
    ru: "",
  });
  assert.deepEqual(
    parseBatchVerdict(
      'Here you go:\n```json\n{"units":[{"id":1,"errors":[{"category":"terminology",' +
        '"severity":"major","explanation":"glossary term ignored"}],"ru":" Клинок "}]}\n```',
    )?.get(1),
    {
      errors: [
        { category: "terminology", severity: "major", explanation: "glossary term ignored" },
      ],
      ru: "Клинок",
    },
  );
  // Unparseable output is a FAILED request, not a verdict: `null`, never an
  // empty annotation — that would stamp the units "reviewed OK" unreviewed.
  assert.equal(parseBatchVerdict("I think it is fine, honestly"), null);
  assert.equal(parseBatchVerdict("{ broken"), null);
  // JSON truncated by the completion cap parses to nothing — also a failure.
  assert.equal(parseBatchVerdict('{"units":[{"id":1,"errors":[{"category":"termino'), null);
  // An answer with no annotations at all is a failure too, not "all fine".
  assert.equal(parseBatchVerdict('{"units":[]}'), null);
  // A malformed error entry (bogus severity) is dropped, not trusted.
  assert.deepEqual(
    parseBatchVerdict(
      '{"units":[{"id":1,"errors":[{"category":"x","severity":"huge"}],"ru":"Х"}]}',
    )?.get(1)?.errors,
    [],
  );
});

test("parseBatchVerdict keys by the answer's ids, not by position", () => {
  const out = parseBatchVerdict(
    '{"units":[{"id":2,"errors":[],"ru":"Второй"},{"id":1,"errors":[],"ru":"Первый"}]}',
  );
  assert.equal(out?.get(1)?.ru, "Первый");
  assert.equal(out?.get(2)?.ru, "Второй");
});

test("parseBatchVerdict drops an entry with no usable id, and both of a duplicated one", () => {
  const out = parseBatchVerdict(
    '{"units":[{"errors":[],"ru":"Безымянный"},{"id":1,"errors":[],"ru":"А"},' +
      '{"id":1,"errors":[],"ru":"Б"},{"id":3,"errors":[],"ru":"В"}]}',
  );
  // Two annotations claiming unit 1 is the model losing track of the batch:
  // neither is trustworthy over the other, so the unit simply goes unanswered.
  assert.equal(out?.has(1), false);
  assert.equal(out?.get(3)?.ru, "В");
  assert.equal(out?.size, 1);
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
/** The per-unit blocks of a batch message, in the order they were sent. */
const unitBlocks = (user: string): string[] => user.split("\n\n---\n\n");

/** A client that answers each unit of a batch by its own blocks. */
const clientOf = (
  respond: (unit: string) => Omit<Verdict, "errors"> & { errors: Verdict["errors"] },
): { calls: string[]; chat: (messages: ChatMessage[]) => Promise<string> } => {
  const calls: string[] = [];
  return {
    calls,
    chat: (messages) => {
      const user = messages[messages.length - 1]?.content ?? "";
      calls.push(user);
      const units = unitBlocks(user).map((block, i) => ({ id: i + 1, ...respond(block) }));
      return Promise.resolve(JSON.stringify({ units }));
    },
  };
};

/** A client whose raw reply is scripted verbatim — for malformed answers. */
const rawClientOf = (
  respond: (user: string) => string,
): { calls: string[]; chat: (messages: ChatMessage[]) => Promise<string> } => {
  const calls: string[] = [];
  return {
    calls,
    chat: (messages) => {
      const user = messages[messages.length - 1]?.content ?? "";
      calls.push(user);
      return Promise.resolve(respond(user));
    },
  };
};

const KEEP: Verdict = { errors: [], ru: "" };
const fixWith = (ru: string): Verdict => ({
  errors: [{ category: "accuracy/mistranslation", severity: "major", explanation: "x" }],
  ru,
});

test("judgeTm judges each identical context once and fans the verdict out", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Adventure", "Приключение"),
    c: liveUnit("Sect", "Секта"),
  });
  const client = clientOf((unit) => (unit.includes("Adventure") ? fixWith("Странствие") : KEEP));

  // batch 1 so the dedup is what the request count measures, not the packing.
  const stats = await judgeTm(tm, client, emptyGlossary, { now: "T", batch: 1 });

  assert.equal(client.calls.length, 2); // one per group, not per unit
  assert.equal(stats.requests, 2);
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
  const client = rawClientOf(() => "Sure! The translation looks fine to me.");

  const stats = await judgeTm(tm, client, emptyGlossary, { memo });

  assert.equal(stats.errors, 1);
  assert.equal(stats.judged, 0);
  assert.equal(stats.ok, 0);
  assert.equal(memo.size, 0);
  assert.equal(tm.units.a?.judgeHash, undefined);
  assert.equal(tm.units.b?.judgeHash, undefined);
  assert.match(stats.problems[0]?.detail ?? "", /unparseable/);
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

/** A whole batch answer for a request carrying exactly one unit. */
const oneUnit = (verdict: Verdict): string => JSON.stringify({ units: [{ id: 1, ...verdict }] });

test("the default window keeps every request stateless", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
    c: liveUnit("Blade", "Клинок"),
  });
  const client = sessionClientOf(() => oneUnit(KEEP));

  await judgeTm(tm, client, emptyGlossary, { concurrency: 1, batch: 1 });

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
  const client = sessionClientOf(() => oneUnit(KEEP));

  await judgeTm(tm, client, emptyGlossary, { concurrency: 1, sessionTurns: 3, batch: 1 });

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
  for (const bad of ["Sure, it all looks fine to me.", oneUnit(fixWith("Adventure тур"))]) {
    const tm = tmOf({
      a: liveUnit("Adventure", "Приключение"),
      b: liveUnit("Sect", "Секта"),
    });
    const client = sessionClientOf((user) => (user.includes("Adventure") ? bad : oneUnit(KEEP)));

    await judgeTm(tm, client, emptyGlossary, { concurrency: 1, sessionTurns: 5, batch: 1 });

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
  const client = sessionClientOf(() => oneUnit(KEEP));

  await judgeTm(tm, client, emptyGlossary, { concurrency: 2, sessionTurns: 4, batch: 1 });

  // Two lanes → two conversations, and a turn of one never lands in the other.
  assert.equal(client.calls.filter((m) => m.length === 2).length, 2);
  const withFirst = client.calls.filter((c) => usersOf(c).some((u) => u.includes("Adventure")));
  assert.ok(withFirst.length > 0);
  assert.ok(withFirst.every((c) => !usersOf(c).some((u) => u.includes("Sect"))));
});

test("orderJudgeFiles puts the smallest files first, or the largest on request", () => {
  const planned = new Map([
    ["big.txt", 900],
    ["one.txt", 1],
    ["mid.txt", 40],
    ["also-one.txt", 1],
  ]);
  const files = [...planned.keys()];

  // Default: whole files finish early, so an interrupt leaves the most done.
  assert.deepEqual(orderJudgeFiles(files, planned), [
    "also-one.txt",
    "one.txt",
    "mid.txt",
    "big.txt",
  ]);
  // --largest-first: the one-unit files (one request each, whatever the batch
  // size) are pushed to the tail so the run opens with full batches.
  assert.deepEqual(orderJudgeFiles(files, planned, true), [
    "big.txt",
    "mid.txt",
    "also-one.txt",
    "one.txt",
  ]);
  // Ties break by name in both directions, so a run is reproducible.
  assert.deepEqual(orderJudgeFiles(["b.txt", "a.txt"], new Map(), true), ["a.txt", "b.txt"]);
  // The input is not reordered in place.
  assert.deepEqual(files, ["big.txt", "one.txt", "mid.txt", "also-one.txt"]);
});

test("batchByCost respects both limits and never drops an oversized item", () => {
  const cost = (n: number): number => n;
  // The count cap closes the batch.
  assert.deepEqual(batchByCost([1, 1, 1, 1, 1], 2, 100, cost), [[1, 1], [1, 1], [1]]);
  // The budget closes it earlier than the count would.
  assert.deepEqual(batchByCost([4, 4, 4], 10, 8, cost), [[4, 4], [4]]);
  // An item heavier than the whole budget travels alone rather than vanishing.
  assert.deepEqual(batchByCost([50, 1], 10, 10, cost), [[50], [1]]);
  assert.deepEqual(batchByCost([], 10, 10, cost), []);
});

test("buildBatchMessage numbers its units and keeps their blocks intact", () => {
  const ctx = (en: string, ru: string): Parameters<typeof buildUserMessage>[0] => ({
    file: "f.txt",
    key: en,
    en,
    cn: `原文:${en}`,
    ru,
  });
  const msg = buildBatchMessage([ctx("Adventure", "Приключение"), ctx("Sect", "Секта")], new Map());

  assert.match(msg, /^UNIT 1\n/);
  assert.match(msg, /\nUNIT 2\n/);
  assert.deepEqual(unitBlocks(msg).length, 2);
  assert.match(unitBlocks(msg)[1] ?? "", /ENGLISH:\nSect/);
});

test("a batch carries several contexts in one request and scatters the answer back", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
    c: liveUnit("Blade", "Клинок"),
  });
  const client = clientOf((unit) => (unit.includes("Blade") ? fixWith("Меч") : KEEP));

  const stats = await judgeTm(tm, client, emptyGlossary, { now: "T", batch: 10 });

  assert.equal(client.calls.length, 1); // three contexts, one round trip
  assert.equal(stats.requests, 1);
  assert.equal(stats.judged, 3);
  assert.equal(stats.ok, 2);
  assert.equal(stats.fixed, 1);
  // The rewrite landed on ITS unit, and only that one.
  assert.equal(tm.units.c?.ru, "Меч");
  assert.equal(tm.units.c?.status, "judged");
  assert.equal(tm.units.a?.ru, "Приключение");
  assert.equal(tm.units.b?.ru, "Секта");
  for (const key of ["a", "b", "c"] as const) assert.ok(tm.units[key]?.judgeHash);
});

test("the character budget closes a batch early", async () => {
  const tm = tmOf({
    a: liveUnit("x".repeat(300), "и".repeat(300)),
    b: liveUnit("y".repeat(300), "и".repeat(300)),
    c: liveUnit("z".repeat(300), "и".repeat(300)),
  });
  const client = clientOf(() => KEEP);

  // Each context costs en + cn + ru; two of them already overrun 1500.
  const stats = await judgeTm(tm, client, emptyGlossary, { batch: 40, batchChars: 1500 });

  assert.equal(stats.requests, 3);
  assert.equal(stats.judged, 3);
});

test("a unit missing from the batch answer stays retryable while its neighbours apply", async () => {
  const memo = new Map<string, JudgeOutcome>();
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
    c: liveUnit("Blade", "Клинок"),
  });
  // The model answers about units 1 and 3 and silently forgets unit 2.
  const client = rawClientOf(() =>
    JSON.stringify({
      units: [
        { id: 1, errors: [], ru: "" },
        { id: 3, errors: [], ru: "" },
      ],
    }),
  );

  const stats = await judgeTm(tm, client, emptyGlossary, { memo, batch: 10 });

  assert.equal(client.calls.length, 1); // no split: the answer itself was readable
  assert.equal(stats.judged, 2);
  assert.equal(stats.errors, 1);
  assert.ok(tm.units.a?.judgeHash);
  assert.ok(tm.units.c?.judgeHash);
  assert.equal(tm.units.b?.judgeHash, undefined); // unanswered → next run retries it
  assert.equal(memo.size, 2);
  assert.match(stats.problems[0]?.detail ?? "", /missing from the batch answer/);
});

test("an unreadable batch answer is split and retried, salvaging the rest", async () => {
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
    c: liveUnit("Blade", "Клинок"),
    d: liveUnit("Mirror", "Зеркало"),
  });
  // One poisonous context: any request carrying it comes back as prose.
  const client = rawClientOf((user) =>
    user.includes("Adventure")
      ? "I could not follow the format, sorry."
      : JSON.stringify({
          units: unitBlocks(user).map((_block, i) => ({ id: i + 1, errors: [], ru: "" })),
        }),
  );

  const stats = await judgeTm(tm, client, emptyGlossary, { concurrency: 1, batch: 4 });

  // [a b c d] → [a b] + [c d]; [a b] → [a] + [b]. Five requests, one dead unit.
  assert.equal(stats.requests, 5);
  assert.equal(stats.judged, 3);
  assert.equal(stats.errors, 1);
  assert.equal(tm.units.a?.judgeHash, undefined);
  for (const key of ["b", "c", "d"] as const) assert.ok(tm.units[key]?.judgeHash);
});

test("a QA-rejected rewrite inside a batch costs only its own unit", async () => {
  const memo = new Map<string, JudgeOutcome>();
  const tm = tmOf({
    a: liveUnit("Adventure", "Приключение"),
    b: liveUnit("Sect", "Секта"),
  });
  // The "fix" for the first unit leaves Latin in the Russian; the second is fine.
  const client = clientOf((unit) =>
    unit.includes("Adventure") ? fixWith("Adventure тур") : fixWith("Школа"),
  );

  const stats = await judgeTm(tm, client, emptyGlossary, { memo, batch: 10 });

  assert.equal(stats.requests, 1);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.fixed, 1);
  assert.equal(tm.units.a?.ru, "Приключение"); // untouched and unmarked
  assert.equal(tm.units.a?.judgeHash, undefined);
  assert.equal(tm.units.b?.ru, "Школа");
  assert.equal(memo.size, 1);
});

test("a memo hit is settled before packing, so it never takes up a batch slot", async () => {
  const settled = liveUnit("Adventure", "Приключение");
  const memo = new Map<string, JudgeOutcome>([
    [verdictKey(realHash("Adventure"), settled), { kind: "fix", ru: "Странствие" }],
  ]);
  const tm = tmOf({ a: settled, b: liveUnit("Sect", "Секта") });
  const client = clientOf(() => KEEP);

  const stats = await judgeTm(tm, client, emptyGlossary, { memo, batch: 10 });

  assert.equal(stats.requests, 1);
  assert.equal(stats.reused, 1);
  // Only the unsettled context was sent.
  assert.equal(unitBlocks(client.calls[0] ?? "").length, 1);
  assert.match(client.calls[0] ?? "", /ENGLISH:\nSect/);
  assert.equal(tm.units.a?.ru, "Странствие");
});

test("a batched turn does not close the session window on characters alone", async () => {
  // A batch is a whole turn, so a history cap sized for single units would end
  // every conversation after two turns and make --session-turns a no-op.
  const long = "x".repeat(4000);
  const tm = tmOf({
    a: liveUnit(`${long}1`, "и".repeat(400)),
    b: liveUnit(`${long}2`, "и".repeat(400)),
    c: liveUnit(`${long}3`, "и".repeat(400)),
  });
  const client = sessionClientOf(() => oneUnit(KEEP));

  await judgeTm(tm, client, emptyGlossary, {
    concurrency: 1,
    sessionTurns: 3,
    batch: 1,
    batchChars: 12_000,
  });

  // Three turns of one conversation: 2, 4, 6 messages.
  assert.deepEqual(
    client.calls.map((m) => m.length),
    [2, 4, 6],
  );
});

test("the CN block says so when the string has no Chinese original", () => {
  const msg = buildUserMessage(
    { file: "f.txt", key: "k", en: "Hello", cn: null, ru: "Привет" },
    new Map(),
  );
  assert.match(msg, /CHINESE: \(absent/);
});
