/**
 * Low-level client for Yandex AI Studio (Foundation Models) text generation, via
 * its OpenAI-compatible endpoint. Used by the LLM judge (`src/judge`); shares the
 * {@link ChatClient} contract with {@link LmStudioClient}, so the judge is
 * backend-agnostic.
 *
 * The endpoint is OpenAI-shaped — POST `/chat/completions` with `messages` and
 * `response_format: { type: "json_schema", … }` for structured output — but two
 * things differ from a stock OpenAI server:
 *   - the `model` field is a Yandex model URI, `gpt://<folder-id>/<model>`, not a
 *     bare model name;
 *   - auth is `Api-Key <key>` (preferred) or a `Bearer <iam-token>`, and the
 *     folder id is also sent in the `x-folder-id` header.
 *
 * Config via environment:
 *   TAIWU_YANDEX_API_KEY    API key with the `yc.ai.foundationModels.execute`
 *                           scope (create it in AI Studio). PREFERRED: it does not
 *                           expire, so it survives a long judge run. When unset,
 *                           an IAM token from `yc iam create-token` is used and
 *                           auto-refreshed on a 401 (it lapses after ~12h).
 *   TAIWU_YANDEX_FOLDER_ID  Yandex Cloud folder id. Falls back to
 *                           `yc config get folder-id`.
 *   TAIWU_JUDGE_MODEL       model name+version, default `yandexgpt/latest`.
 *                           `yandexgpt-lite/latest` is cheaper; a full
 *                           `gpt://…` URI is also accepted verbatim (then the
 *                           folder id is not needed to build the URI).
 *   TAIWU_JUDGE_MAX_TOKENS  cap on generated tokens per request (default 2000).
 */
import { backoffMs, delay } from "../util/async.js";
import { cleanOutput, type ChatClient, type ChatMessage, type ChatOptions } from "./chat-client.js";
import { ycFolderId, ycIamToken } from "./yc.js";

const DEFAULT_BASE_URL = "https://llm.api.cloud.yandex.net/v1";
const DEFAULT_MODEL = "yandexgpt/latest";
const DEFAULT_MAX_TOKENS = 2000;
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ChatResponse {
  choices: { message: { content: string | null } }[];
}

/** How the client authenticates: a non-expiring API key, or an IAM token. */
type Auth =
  | { kind: "api-key"; value: string }
  | { kind: "iam"; getToken: () => Promise<string> };

export interface YandexGptConfig {
  baseUrl?: string;
  /** Model name+version (`yandexgpt/latest`) or a full `gpt://…` URI. */
  model?: string;
  maxTokens?: number;
  auth: Auth;
  /** Lazily resolves the folder id (env value or `yc config get folder-id`). */
  getFolderId: () => Promise<string>;
}

export class YandexGptClient implements ChatClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly auth: Auth;
  private readonly getFolderId: () => Promise<string>;

  private folderId: string | null = null;
  private modelUri: string | null = null;
  /** Cached bearer value for the IAM path; refreshed on a 401. */
  private iamToken: string | null = null;

  constructor(cfg: YandexGptConfig) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = cfg.model || DEFAULT_MODEL;
    this.maxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.auth = cfg.auth;
    this.getFolderId = cfg.getFolderId;
  }

  /**
   * Default client: API key from `TAIWU_YANDEX_API_KEY` when present, else an IAM
   * token from the `yc` CLI. Folder id from `TAIWU_YANDEX_FOLDER_ID`, else `yc`.
   * Credentials are resolved lazily on the first request, so a missing key or an
   * uninitialized CLI surfaces a clear error only when the judge actually runs.
   */
  static fromEnv(model?: string): YandexGptClient {
    const apiKey = process.env.TAIWU_YANDEX_API_KEY?.trim();
    const auth: Auth = apiKey
      ? { kind: "api-key", value: apiKey }
      : { kind: "iam", getToken: ycIamToken };
    const envFolder = process.env.TAIWU_YANDEX_FOLDER_ID?.trim();
    const maxTokens = Number(process.env.TAIWU_JUDGE_MAX_TOKENS);
    return new YandexGptClient({
      model: model ?? process.env.TAIWU_JUDGE_MODEL,
      maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : undefined,
      auth,
      getFolderId: envFolder ? () => Promise.resolve(envFolder) : ycFolderId,
    });
  }

  /**
   * Resolve the model URI once, so the CLI can print it and fail fast if the
   * folder id can't be resolved. A `gpt://…` model is used verbatim; a bare
   * `name/version` is expanded against the folder id.
   */
  async ensureModel(): Promise<string> {
    if (this.modelUri) return this.modelUri;
    if (this.model.startsWith("gpt://")) {
      this.modelUri = this.model;
      return this.modelUri;
    }
    this.folderId ??= await this.getFolderId();
    this.modelUri = `gpt://${this.folderId}/${this.model}`;
    return this.modelUri;
  }

  /** The `x-folder-id` header value (resolved lazily alongside the model URI). */
  private async ensureFolderId(): Promise<string> {
    this.folderId ??= await this.getFolderId();
    return this.folderId;
  }

  /** The `Authorization` header value; `refresh` re-mints a lapsed IAM token. */
  private async authHeader(refresh = false): Promise<string> {
    if (this.auth.kind === "api-key") return `Api-Key ${this.auth.value}`;
    if (refresh || this.iamToken === null) this.iamToken = await this.auth.getToken();
    return `Bearer ${this.iamToken}`;
  }

  /** One chat completion; returns the assistant text with reasoning stripped. */
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const modelUri = await this.ensureModel();
    const folderId = await this.ensureFolderId();
    const body = JSON.stringify({
      model: modelUri,
      temperature: opts.temperature ?? 0,
      max_tokens: this.maxTokens,
      stream: false,
      messages,
      ...(opts.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: opts.jsonSchema } }
        : {}),
    });
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const authorization = await this.authHeader();
        res = await fetchWithTimeout(
          `${this.baseUrl}/chat/completions`,
          body,
          { Authorization: authorization, "x-folder-id": folderId },
          timeoutMs,
        );
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err; // network/timeout
        await delay(backoffMs(attempt));
        continue;
      }

      if (res.ok) {
        const json = (await res.json()) as ChatResponse;
        return cleanOutput(json.choices[0]?.message.content ?? "");
      }

      const detail = (await res.text().catch(() => "")).slice(0, 300);
      // A lapsed IAM token reads as 401; re-mint it once and retry immediately
      // (this attempt is not "used up"). An API key never 401s this way.
      if ((res.status === 401 || res.status === 403) && this.auth.kind === "iam") {
        await this.authHeader(true);
        if (attempt < MAX_RETRIES) continue;
      }
      // Fail fast on permanent request problems (a context-window overflow fails
      // identically on every retry); back off and retry everything else.
      if (attempt >= MAX_RETRIES || isPermanent(detail)) {
        throw new Error(
          `Yandex AI Studio chat/completions ${res.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      await delay(backoffMs(attempt));
    }
  }
}

/**
 * Whether a server error body describes a PERMANENT request problem — one that
 * would fail identically on every retry. The one we hit is a context-window
 * overflow (a long unit plus the judge prompt exceeds the model's context); the
 * fix is a shorter prompt, not another attempt.
 */
function isPermanent(body: string): boolean {
  return /context (?:size|length)|exceed|too (?:long|large|many tokens)/i.test(body);
}

async function fetchWithTimeout(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
