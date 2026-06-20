/**
 * Local LLM engine via LM Studio's OpenAI-compatible server.
 *
 * Config via environment (all optional — it points at a local server):
 *   TAIWU_LMSTUDIO_BASE_URL   default http://localhost:1234/v1
 *   TAIWU_LMSTUDIO_MODEL      default: first non-embedding model the server lists
 *   TAIWU_LMSTUDIO_CONCURRENCY default 4
 *
 * Each masked text is translated with one chat completion. The system prompt
 * tells the model to preserve the ⟦n⟧ placeholder tokens verbatim; the pipeline
 * still validates this on restore, so a model that mangles them flags the unit
 * rather than writing corrupt output.
 *
 * Reasoning is disabled by default (`enable_thinking: false`) — for a reasoning
 * model like Qwen3 it cuts latency dramatically (~70s → ~1s per request) and the
 * thinking trace never reaches the output. Re-enable with
 * `TAIWU_LMSTUDIO_THINKING=on`. Any inline `<think>…</think>` is also stripped as
 * a fallback for models that ignore the flag.
 */
import type { TranslationEngine, TranslationRequest } from "./types.js";

const SYSTEM_PROMPT = [
  "You are a professional game localizer for The Scroll of Taiwu, a Chinese wuxia",
  "(martial-arts) simulation game. Translate the user's English text into Russian.",
  "The English is itself machine-translated from Chinese, so a Chinese original may",
  "be provided as a MEANING reference — when the English is ambiguous or awkward,",
  "trust the Chinese meaning, but always translate the English text. Rules:",
  "1. Preserve every placeholder token of the form ⟦N⟧ (N is a number) EXACTLY —",
  "   same tokens, same numbers, same count. Never translate, reorder or drop them.",
  "2. Keep the wuxia tone; translate names/terms naturally into Russian.",
  "3. Output ONLY the Russian translation — no quotes, no notes, no original text.",
].join(" ");

const MARKUP_RE = /<[^>]*>|\{\d+\}|⟦\d+⟧/g;

/** A Chinese reference is meaning-only context; strip its markup to avoid noise. */
function referenceContext(reference: string | null | undefined): string | null {
  if (!reference) return null;
  const cleaned = reference.replace(MARKUP_RE, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

const THINK_RE = /<think>[\s\S]*?<\/think>/gi;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;

export interface LmStudioConfig {
  baseUrl?: string;
  model?: string;
  concurrency?: number;
  /** Allow the model to emit reasoning. Default false (much faster). */
  thinking?: boolean;
}

interface ModelsResponse {
  data: { id: string }[];
}
interface ChatResponse {
  choices: { message: { content: string | null } }[];
}

export class LmStudioEngine implements TranslationEngine {
  readonly id = "lmstudio";
  private readonly baseUrl: string;
  private readonly concurrency: number;
  private readonly thinking: boolean;
  private model: string | null;

  constructor(cfg: LmStudioConfig = {}) {
    this.baseUrl = (cfg.baseUrl ?? "http://localhost:1234/v1").replace(/\/$/, "");
    this.model = cfg.model ?? null;
    this.concurrency = Math.max(1, cfg.concurrency ?? 4);
    this.thinking = cfg.thinking ?? false;
  }

  static fromEnv(): LmStudioEngine {
    const concurrency = Number(process.env.TAIWU_LMSTUDIO_CONCURRENCY);
    return new LmStudioEngine({
      baseUrl: process.env.TAIWU_LMSTUDIO_BASE_URL,
      model: process.env.TAIWU_LMSTUDIO_MODEL,
      concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
      thinking: /^(on|1|true|yes)$/i.test(process.env.TAIWU_LMSTUDIO_THINKING ?? ""),
    });
  }

  async translate(requests: TranslationRequest[]): Promise<string[]> {
    await this.ensureModel();
    return mapPool(requests, this.concurrency, (req) => this.translateOne(req));
  }

  /** Resolve the model id once: explicit config, else first non-embedding model. */
  private async ensureModel(): Promise<void> {
    if (this.model) return;
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
  }

  private async translateOne(req: TranslationRequest): Promise<string> {
    const reference = referenceContext(req.reference);
    const userContent = reference
      ? `Chinese original (meaning reference): ${reference}\n\nEnglish to translate:\n${req.text}`
      : req.text;
    const payload: Record<string, unknown> = {
      model: this.model,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    };
    if (!this.thinking) {
      // Disable reasoning. `enable_thinking` works for Qwen3 via LM Studio;
      // `chat_template_kwargs` covers other servers/models.
      payload.enable_thinking = false;
      payload.chat_template_kwargs = { enable_thinking: false };
    }
    const body = JSON.stringify(payload);

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, body);
        if (!res.ok) {
          if (res.status >= 500 && attempt < MAX_RETRIES) continue;
          throw new Error(`LM Studio chat/completions ${res.status}`);
        }
        const json = (await res.json()) as ChatResponse;
        return cleanOutput(json.choices[0]?.message.content ?? "");
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
      }
    }
  }
}

async function fetchWithTimeout(url: string, body: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

/** Strip reasoning blocks and surrounding whitespace/quotes from model output. */
export function cleanOutput(raw: string): string {
  let out = raw.replace(THINK_RE, "").trim();
  // Drop a single pair of wrapping quotes the model may have added.
  if (out.length >= 2 && /^["“'«]/.test(out) && /["”'»]$/.test(out)) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i] as T, i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
