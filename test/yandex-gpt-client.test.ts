import assert from "node:assert/strict";
import { test } from "node:test";

import { YandexGptClient } from "../src/engine/yandex-gpt-client.js";

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

function completion(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

const apiKeyClient = () =>
  new YandexGptClient({
    auth: { kind: "api-key", value: "test-key" },
    getFolderId: () => Promise.resolve("folder-123"),
  });

test("ensureModel expands a bare name against the folder id", async () => {
  assert.equal(await apiKeyClient().ensureModel(), "gpt://folder-123/yandexgpt/latest");
});

test("ensureModel passes a full gpt:// URI through and needs no folder id", async () => {
  const client = new YandexGptClient({
    model: "gpt://other-folder/yandexgpt-lite/rc",
    auth: { kind: "api-key", value: "k" },
    getFolderId: () => Promise.reject(new Error("folder id must not be resolved")),
  });
  assert.equal(await client.ensureModel(), "gpt://other-folder/yandexgpt-lite/rc");
});

test("chat sends the model URI, api-key auth, folder header and structured output", async () => {
  let sent: { url: string; init?: RequestInit } = { url: "" };
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    sent = { url: String(url), init };
    return Promise.resolve(completion('{"errors":[],"ru":""}'));
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    const out = await apiKeyClient().chat([{ role: "user", content: "hi" }], {
      jsonSchema: { name: "mqm", schema: { type: "object" } },
    });
    assert.equal(out, '{"errors":[],"ru":""}');
  });

  assert.ok(sent.url.endsWith("/v1/chat/completions"));
  const headers = sent.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Api-Key test-key");
  assert.equal(headers["x-folder-id"], "folder-123");
  const body = JSON.parse(sent.init?.body as string) as {
    model: string;
    response_format: { type: string; json_schema: { name: string } };
    temperature: number;
  };
  assert.equal(body.model, "gpt://folder-123/yandexgpt/latest");
  assert.equal(body.temperature, 0);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "mqm");
});

test("a lapsed IAM token (401) is re-minted and the request retried", async () => {
  const tokens = ["stale-token", "fresh-token"];
  let mintCount = 0;
  const seenAuth: string[] = [];
  const fetchImpl = ((_url: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    seenAuth.push(String(headers.Authorization));
    // First call carries the stale token → 401; the retry carries the fresh one.
    if (headers.Authorization === "Bearer stale-token") {
      return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
    }
    return Promise.resolve(completion("ok"));
  }) as FetchFn;

  const client = new YandexGptClient({
    auth: {
      kind: "iam",
      getToken: () => Promise.resolve(tokens[mintCount++] ?? "fresh-token"),
    },
    getFolderId: () => Promise.resolve("f"),
  });

  await withFetch(fetchImpl, async () => {
    assert.equal(await client.chat([{ role: "user", content: "hi" }]), "ok");
  });
  assert.deepEqual(seenAuth, ["Bearer stale-token", "Bearer fresh-token"]);
});

test("a context-overflow 400 fails fast without retrying", async () => {
  let calls = 0;
  const fetchImpl = (() => {
    calls++;
    return Promise.resolve(jsonResponse({ error: "context length exceeded" }, 400));
  }) as FetchFn;

  await withFetch(fetchImpl, async () => {
    await assert.rejects(
      () => apiKeyClient().chat([{ role: "user", content: "hi" }]),
      /chat\/completions 400/,
    );
  });
  assert.equal(calls, 1, "permanent error must not be retried");
});
