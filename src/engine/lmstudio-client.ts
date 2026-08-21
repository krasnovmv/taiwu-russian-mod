/**
 * Low-level client for LM Studio's OpenAI-compatible server, shared by the
 * translation engine ({@link LmStudioEngine}) and the LLM judge (`src/judge`).
 *
 * It owns exactly the plumbing both need: base URL, lazy model resolution,
 * timeouts, retry-with-backoff on transient failures, and reasoning being turned
 * off. Prompting, glossary handling and output validation live in the callers.
 *
 * Config via environment (all optional — it points at a local server):
 *   TAIWU_LMSTUDIO_BASE_URL          default http://localhost:1234/v1
 *   TAIWU_LMSTUDIO_MODEL             default: first non-embedding model the server lists
 *   TAIWU_LMSTUDIO_REASONING_EFFORT  default "none"; empty = omit the field
 *
 * Reasoning is disabled by default — for a reasoning model like Qwen3 it cuts
 * latency dramatically (~70s → ~1s per request) and the thinking trace never
 * reaches the output. Any inline `<think>…</think>` is stripped as a fallback for
 * models that ignore the flag. Not every OpenAI-compatible server accepts
 * `reasoning_effort: "none"` though (an OpenAI-backed one rejects the whole
 * request with a 400, listing low/medium/high as the only values), hence the
 * override: set the level the server does accept, or set it empty to leave the
 * field out entirely.
 */
import { backoffMs, delay } from "../util/async.js";
import { cleanOutput, type ChatMessage, type ChatOptions } from "./chat-client.js";

// Re-exported so long-standing importers (e.g. `engine/lmstudio.ts`) keep their
// paths; the definitions now live in the shared `chat-client.ts`.
export { cleanOutput, mapPool } from "./chat-client.js";
export type { ChatMessage, ChatOptions, ChatClient } from "./chat-client.js";

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ModelsResponse {
  data: { id: string }[];
}
interface ChatResponse {
  choices: { message: { content: string | null } }[];
}

export class LmStudioClient {
  private readonly baseUrl: string;
  private model: string | null;
  /** Value for `reasoning_effort`; `null` leaves the field out of the request. */
  private readonly reasoningEffort: string | null;

  constructor(cfg: { baseUrl?: string; model?: string; reasoningEffort?: string | null } = {}) {
    this.baseUrl = (cfg.baseUrl ?? "http://localhost:1234/v1").replace(/\/$/, "");
    this.model = cfg.model ?? null;
    this.reasoningEffort = cfg.reasoningEffort === undefined ? "none" : cfg.reasoningEffort;
  }

  static fromEnv(model?: string): LmStudioClient {
    const effort = process.env.TAIWU_LMSTUDIO_REASONING_EFFORT;
    return new LmStudioClient({
      baseUrl: process.env.TAIWU_LMSTUDIO_BASE_URL,
      model: model ?? process.env.TAIWU_LMSTUDIO_MODEL,
      // Set but empty is a deliberate "send no reasoning_effort at all".
      reasoningEffort: effort === undefined ? "none" : effort.trim() || null,
    });
  }

  /** Resolve the model id once: explicit config, else first non-embedding model. */
  async ensureModel(): Promise<string> {
    if (this.model) return this.model;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/models`);
    } catch (err) {
      throw new Error(`LM Studio not reachable at ${this.baseUrl} (${(err as Error).message})`, {
        cause: err,
      });
    }
    if (!res.ok) throw new Error(`LM Studio /models returned ${res.status}`);
    const json = (await res.json()) as ModelsResponse;
    const chat = json.data.find((m) => !/embed/i.test(m.id)) ?? json.data[0];
    if (!chat) throw new Error("LM Studio has no model loaded");
    this.model = chat.id;
    return this.model;
  }

  /** One chat completion; returns the assistant text with reasoning stripped. */
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const model = await this.ensureModel();
    const body = JSON.stringify({
      model,
      temperature: opts.temperature ?? 0,
      stream: false,
      messages,
      ...(opts.jsonSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { ...opts.jsonSchema, strict: true },
            },
          }
        : {}),
      // Disable reasoning. Different models honour different switches, so send
      // all of them (unknown params are ignored): `enable_thinking` works for
      // Qwen3.5, `reasoning_effort` for small Qwen3 (e.g. 0.6b), and
      // `chat_template_kwargs` covers other servers/models.
      enable_thinking: false,
      ...(this.reasoningEffort === null ? {} : { reasoning_effort: this.reasoningEffort }),
      chat_template_kwargs: { enable_thinking: false },
    });
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, body, timeoutMs);
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err; // network/timeout
        await delay(backoffMs(attempt));
        continue;
      }

      if (res.ok) {
        const json = (await res.json()) as ChatResponse;
        return cleanOutput(json.choices[0]?.message.content ?? "");
      }
      // Retry most non-ok statuses with backoff, not just 5xx: LM Studio returns
      // 400 for transient conditions too — most visibly "model is still loading"
      // at the very start of a run — and those succeed on a retry.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      // …but some 400s are PERMANENT: a context-window overflow (the prompt +
      // input exceed the model's context) fails identically no matter how often
      // it is retried, so fail fast and surface it — the fix is a bigger context
      // window or a shorter prompt, not another attempt.
      if (attempt >= MAX_RETRIES || isPermanent(detail)) {
        throw new Error(`LM Studio chat/completions ${res.status}${detail ? `: ${detail}` : ""}`);
      }
      await delay(backoffMs(attempt));
    }
  }
}

/**
 * Whether a server error body describes a PERMANENT request problem — one that
 * would fail identically on every retry, so retrying only wastes attempts. Two
 * we hit in the wild: a context-window overflow (a long unit plus the judge
 * prompt exceeds the model's context), which LM Studio reports as a 400 whose
 * body says the context size was exceeded; and a rejected request parameter
 * (e.g. a server that does not accept `reasoning_effort: "none"`), where the
 * body is an invalid-request/enum complaint. Both need a config change, not
 * another attempt.
 */
function isPermanent(body: string): boolean {
  return (
    /context (?:size|length)|exceed|too (?:long|large|many tokens)/i.test(body) ||
    /invalid[_ ](?:request|enum)|invalid enum value/i.test(body)
  );
}

async function fetchWithTimeout(url: string, body: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
