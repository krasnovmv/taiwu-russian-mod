import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanOutput, LmStudioEngine, mapPool } from "../src/engine/lmstudio.js";

type FetchFn = typeof globalThis.fetch;

/** Run `body` with globalThis.fetch replaced, restoring it afterwards. */
async function withFetch(fetchImpl: FetchFn, body: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await body();
  } finally {
    globalThis.fetch = real;
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

test("cleanOutput strips <think> blocks", () => {
  assert.equal(cleanOutput("<think>reasoning here</think>Привет"), "Привет");
  assert.equal(cleanOutput("<think>\nmulti\nline\n</think>\n  Текст  "), "Текст");
});

test("cleanOutput removes a single pair of wrapping quotes", () => {
  assert.equal(cleanOutput('"Железное кольцо"'), "Железное кольцо");
  assert.equal(cleanOutput("«Текст»"), "Текст");
  assert.equal(cleanOutput("Без кавычек"), "Без кавычек");
});

test("cleanOutput preserves placeholder tokens", () => {
  assert.equal(cleanOutput("Наносит <m0></m0> урона"), "Наносит <m0></m0> урона");
});

test("mapPool preserves order with bounded concurrency", async () => {
  const items = [1, 2, 3, 4, 5];
  const out = await mapPool(items, 2, (n) => Promise.resolve(n * 10));
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test("mapPool runs at most `concurrency` tasks at once", async () => {
  let active = 0;
  let peak = 0;
  await mapPool(
    Array.from({ length: 10 }, (_, i) => i),
    3,
    async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return 0;
    },
  );
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded 3`);
});

test("ensureModel picks the first non-embedding model; reference markup is stripped", async () => {
  let chatBody: { model?: string; messages?: { content: string }[] } = {};
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/models")) {
      return Promise.resolve(
        jsonResponse({ data: [{ id: "text-embedding-x" }, { id: "qwen-chat" }] }),
      );
    }
    chatBody = JSON.parse(init?.body as string) as typeof chatBody;
    return Promise.resolve(
      jsonResponse({ choices: [{ message: { content: "привет <m0></m0>" } }] }),
    );
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const engine = new LmStudioEngine({});
    const out = await engine.translate([
      { text: "hello <m0></m0>", reference: "<color=#x>甲</color>" },
    ]);
    assert.deepEqual(out, ["привет <m0></m0>"]);
    assert.equal(chatBody.model, "qwen-chat");
    const user = chatBody.messages?.[1]?.content ?? "";
    assert.ok(user.includes("甲"), "CN meaning present");
    assert.ok(!user.includes("<color"), "CN markup stripped");
  });
});

test("a zh-source request tells the model the text is Chinese", async () => {
  let user = "";
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/models"))
      return Promise.resolve(jsonResponse({ data: [{ id: "m" }] }));
    const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
    user = body.messages[1]?.content ?? "";
    return Promise.resolve(jsonResponse({ choices: [{ message: { content: "перевод" } }] }));
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const engine = new LmStudioEngine({});
    const out = await engine.translate([{ text: "未至此地", sourceLang: "zh" }]);
    assert.deepEqual(out, ["перевод"]);
    assert.ok(user.includes("Chinese to translate"), "labels the source as Chinese");
    assert.ok(user.includes("the text below is Chinese"), "explicit note present");
    assert.ok(user.includes("未至此地"), "source text present");
  });
});

test("glossary terms in the text are injected into the prompt", async () => {
  let user = "";
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/models"))
      return Promise.resolve(jsonResponse({ data: [{ id: "m" }] }));
    const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
    user = body.messages[1]?.content ?? "";
    return Promise.resolve(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const glossary = new Map([
      ["qi", "ци"],
      ["loong", "лун"],
    ]);
    const engine = new LmStudioEngine({ glossary });
    await engine.translate([{ text: "Restore your Qi" }]);
    assert.ok(user.includes("Glossary"), "glossary block present");
    assert.ok(user.includes("qi → ци"), "matched term listed");
    assert.ok(!user.includes("лун"), "unmatched term omitted");
    assert.ok(user.includes("Restore your Qi"), "source text present");
  });
});

test("no glossary block when no term applies", async () => {
  let user = "";
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/models"))
      return Promise.resolve(jsonResponse({ data: [{ id: "m" }] }));
    const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
    user = body.messages[1]?.content ?? "";
    return Promise.resolve(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const engine = new LmStudioEngine({ glossary: new Map([["qi", "ци"]]) });
    await engine.translate([{ text: "nothing relevant here" }]);
    assert.ok(!user.includes("Glossary"), "no glossary block");
  });
});

test("client errors (4xx) fail fast without retry", async () => {
  let chatCalls = 0;
  const fetchImpl = ((url: string | URL) => {
    if (String(url).endsWith("/models"))
      return Promise.resolve(jsonResponse({ data: [{ id: "m" }] }));
    chatCalls++;
    return Promise.resolve(new Response("bad request", { status: 400 }));
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const engine = new LmStudioEngine({});
    await assert.rejects(engine.translate([{ text: "x" }]), /400/);
    assert.equal(chatCalls, 1); // no retry
  });
});

test("transient 5xx is retried, then succeeds", async () => {
  let chatCalls = 0;
  const fetchImpl = ((url: string | URL) => {
    if (String(url).endsWith("/models"))
      return Promise.resolve(jsonResponse({ data: [{ id: "m" }] }));
    chatCalls++;
    return Promise.resolve(
      chatCalls === 1
        ? new Response("upstream", { status: 503 })
        : jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const engine = new LmStudioEngine({});
    const out = await engine.translate([{ text: "x" }]);
    assert.deepEqual(out, ["ok"]);
    assert.equal(chatCalls, 2);
  });
});

test("errors clearly when no model is loaded", async () => {
  const fetchImpl = ((url: string | URL) =>
    String(url).endsWith("/models")
      ? Promise.resolve(jsonResponse({ data: [] }))
      : Promise.resolve(jsonResponse({}))) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const engine = new LmStudioEngine({});
    await assert.rejects(engine.translate([{ text: "x" }]), /no model/i);
  });
});
