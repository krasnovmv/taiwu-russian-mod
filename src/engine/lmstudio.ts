/**
 * Local LLM translation engine via LM Studio's OpenAI-compatible server.
 *
 * Transport (base URL, model resolution, timeouts, retries, reasoning-off) lives
 * in {@link LmStudioClient}; this file owns the translation prompt. Config:
 *   TAIWU_LMSTUDIO_BASE_URL   default http://localhost:1234/v1
 *   TAIWU_LMSTUDIO_MODEL      default: first non-embedding model the server lists
 *   TAIWU_LMSTUDIO_CONCURRENCY default 4
 *
 * Each masked text is translated with one chat completion. The system prompt
 * tells the model to preserve the <mN></mN> placeholder tags verbatim; the pipeline
 * still validates this on restore, so a model that mangles them flags the unit
 * rather than writing corrupt output.
 */
import { matchGlossary } from "../glossary/match.js";
import { LmStudioClient, mapPool } from "./lmstudio-client.js";
import type { ProgressCallback, TranslationEngine, TranslationRequest } from "./types.js";

export { cleanOutput, mapPool } from "./lmstudio-client.js";

const SYSTEM_PROMPT = [
  "You are a professional game localizer for The Scroll of Taiwu, a Chinese wuxia",
  "(martial-arts) simulation game. Translate the user's English text into Russian.",
  "The English is itself machine-translated from Chinese, so a Chinese original may",
  "be provided as a MEANING reference — when the English is ambiguous or awkward,",
  "trust the Chinese meaning, but always translate the English text. Rules:",
  "1. Preserve every placeholder tag of the form <mN></mN> (N is a number) EXACTLY —",
  "   same tags, same numbers, same count. Never translate, reorder, alter or drop them.",
  "   NEVER add a placeholder tag that is not in the source — if the source has none,",
  "   your output must contain none.",
  "2. Keep the wuxia tone; translate names/terms naturally into Russian.",
  "3. If a GLOSSARY is given, use exactly those Russian translations for the listed",
  "   terms, declining them naturally to fit the sentence's grammar (case, number).",
  "4. Output ONLY the Russian translation — no quotes, no notes, no original text.",
].join(" ");

/** Render the glossary terms that apply to `text` as a prompt block (or null). */
function glossaryBlock(text: string, glossary: ReadonlyMap<string, string>): string | null {
  const matches = matchGlossary(text, glossary);
  if (matches.length === 0) return null;
  const lines = matches.map((m) => `${m.en} → ${m.ru}`).join("\n");
  return `Glossary (use these Russian translations, declined to fit grammar):\n${lines}`;
}

const MARKUP_RE = /<[^>]*>|\{\d+\}/g;

/** A Chinese reference is meaning-only context; strip its markup to avoid noise. */
function referenceContext(reference: string | null | undefined): string | null {
  if (!reference) return null;
  const cleaned = reference.replace(MARKUP_RE, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export interface LmStudioConfig {
  baseUrl?: string;
  model?: string;
  concurrency?: number;
  /** EN→RU glossary; matched terms are injected into each request's prompt. */
  glossary?: ReadonlyMap<string, string>;
}

export class LmStudioEngine implements TranslationEngine {
  readonly id = "lmstudio";
  readonly checkpointSize = 20; // slow local LLM (~1s/unit); checkpoint often
  private readonly client: LmStudioClient;
  private readonly concurrency: number;
  private readonly glossary: ReadonlyMap<string, string>;

  constructor(cfg: LmStudioConfig = {}) {
    this.client = new LmStudioClient({ baseUrl: cfg.baseUrl, model: cfg.model });
    this.concurrency = Math.max(1, cfg.concurrency ?? 4);
    this.glossary = cfg.glossary ?? new Map();
  }

  static fromEnv(glossary?: ReadonlyMap<string, string>): LmStudioEngine {
    const concurrency = Number(process.env.TAIWU_LMSTUDIO_CONCURRENCY);
    return new LmStudioEngine({
      baseUrl: process.env.TAIWU_LMSTUDIO_BASE_URL,
      model: process.env.TAIWU_LMSTUDIO_MODEL,
      concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
      glossary,
    });
  }

  async translate(
    requests: TranslationRequest[],
    onProgress?: ProgressCallback,
  ): Promise<string[]> {
    await this.client.ensureModel();
    let done = 0;
    return mapPool(requests, this.concurrency, async (req) => {
      const out = await this.translateOne(req);
      onProgress?.(++done);
      return out;
    });
  }

  private async translateOne(req: TranslationRequest): Promise<string> {
    const glossary = glossaryBlock(req.text, this.glossary);
    // CN-only keys have no English: the text IS Chinese. Tell the model so, and
    // skip the reference (it would just repeat the source).
    const isZh = (req.sourceLang ?? "en") === "zh";
    const reference = isZh ? null : referenceContext(req.reference);
    const userContent = [
      glossary,
      isZh
        ? "NOTE: the text below is Chinese (no English exists). Translate it into Russian."
        : null,
      reference ? `Chinese original (meaning reference): ${reference}` : null,
      `${isZh ? "Chinese" : "English"} to translate:\n${req.text}`,
    ]
      .filter((part): part is string => part !== null)
      .join("\n\n");

    return this.client.chat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);
  }
}
