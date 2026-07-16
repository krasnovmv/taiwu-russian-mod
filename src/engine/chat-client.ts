/**
 * Shared contract and helpers for the OpenAI-style chat clients — LM Studio
 * ({@link LmStudioClient}) and Yandex AI Studio ({@link YandexGptClient}). Both
 * the translation engine and the LLM judge talk to a model through this small
 * surface: a `chat(messages, opts)` call that returns the assistant text, plus
 * the concurrency and output-cleaning utilities they share. Each client owns its
 * own transport, auth and retry policy.
 */

const THINK_RE = /<think>[\s\S]*?<\/think>/gi;

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatOptions {
  /** Sampling temperature; 0 (default) for reproducible localization output. */
  temperature?: number;
  /** Ask the server to constrain output to this JSON schema (structured output). */
  jsonSchema?: { name: string; schema: unknown };
  timeoutMs?: number;
}

/**
 * One chat completion: what the LLM judge (and the LM Studio translation engine)
 * needs from a backend, regardless of whether it is a local server or Yandex AI
 * Studio. Implemented structurally by both clients.
 */
export interface ChatClient {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
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
