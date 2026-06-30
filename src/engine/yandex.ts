/**
 * Yandex Cloud Translate engine, backed by the official SDK
 * (`@yandex-cloud/nodejs-sdk`, gRPC TranslationService v2).
 *
 * Auth & config via environment:
 *   TAIWU_YANDEX_IAM_TOKEN  — IAM token (`yc iam create-token`; valid ~12h)
 *   TAIWU_YANDEX_FOLDER_ID  — Yandex Cloud folder id
 *
 * The API caps a request at ~10k characters, so texts are split by a
 * conservative character budget. Transient gRPC failures are retried with
 * exponential backoff.
 */
import { Session } from "@yandex-cloud/nodejs-sdk";
import { translationService } from "@yandex-cloud/nodejs-sdk/ai-translate-v2";

import { matchGlossary } from "../glossary/match.js";
import { backoffMs, delay } from "../util/async.js";
import type { ProgressCallback, TranslationEngine, TranslationRequest } from "./types.js";
import { ycFolderId, ycIamToken } from "./yc.js";

const CHAR_BUDGET = 9000;
const MAX_TEXTS = 100;
const MAX_RETRIES = 5;
/** Yandex caps a request's glossary at 50 pairs. */
const MAX_GLOSSARY_PAIRS = 50;

function createTranslationClient(iamToken: string) {
  return new Session({ iamToken }).client(translationService.TranslationServiceClient);
}

export interface YandexConfig {
  /** Lazily resolves an IAM token (env value or `yc iam create-token`). */
  getIamToken: () => Promise<string>;
  /** Lazily resolves the folder id (env value or `yc config get folder-id`). */
  getFolderId: () => Promise<string>;
  sourceLang?: string;
  targetLang?: string;
  /** EN→RU glossary; applied via `glossaryConfig` so Yandex inflects each term. */
  glossary?: ReadonlyMap<string, string>;
}

export class YandexEngine implements TranslationEngine {
  readonly id = "yandex";
  readonly checkpointSize = 15; // fast batched MT; whole files complete quickly
  private readonly cfg: Required<Pick<YandexConfig, "sourceLang" | "targetLang">> & YandexConfig;
  private readonly glossary: ReadonlyMap<string, string>;
  private client: ReturnType<typeof createTranslationClient> | null = null;
  private folderId: string | null = null;

  constructor(cfg: YandexConfig) {
    this.cfg = { sourceLang: "en", targetLang: "ru", ...cfg };
    this.glossary = cfg.glossary ?? new Map();
  }

  /**
   * Default engine: credentials always come from the `yc` CLI
   * (`yc iam create-token` / `yc config get folder-id`), resolved lazily on the
   * first translate so a missing/uninitialized CLI surfaces a clear error only
   * when translation actually runs. Inject providers via the constructor to test
   * or to source credentials differently.
   */
  static fromEnv(glossary?: ReadonlyMap<string, string>): YandexEngine {
    return new YandexEngine({ getIamToken: ycIamToken, getFolderId: ycFolderId, glossary });
  }

  /** Resolve credentials and build the gRPC client once, lazily. */
  private async ready(): Promise<void> {
    this.client ??= createTranslationClient(await this.cfg.getIamToken());
    this.folderId ??= await this.cfg.getFolderId();
  }

  async translate(
    requests: TranslationRequest[],
    onProgress?: ProgressCallback,
  ): Promise<string[]> {
    await this.ready();
    // Yandex is pure machine translation; the CN reference is not used. A request
    // carries ONE sourceLanguageCode, so EN and CN-only ("zh") units can't share
    // a call — group by source language and scatter results back by index.
    const results = new Array<string>(requests.length);
    const byLang = new Map<string, number[]>();
    requests.forEach((r, i) => {
      const lang = r.sourceLang ?? this.cfg.sourceLang;
      const idx = byLang.get(lang);
      if (idx) idx.push(i);
      else byLang.set(lang, [i]);
    });

    let completed = 0;
    for (const [lang, indices] of byLang) {
      const texts = indices.map((i) => requests[i]!.text);
      let done = 0;
      for (const batch of batchByChars(texts, CHAR_BUDGET, MAX_TEXTS)) {
        const out = await this.translateBatch(batch, lang);
        for (let k = 0; k < out.length; k++) results[indices[done + k]!] = out[k]!;
        done += out.length;
        completed += out.length;
        onProgress?.(completed);
      }
    }
    return results;
  }

  private async translateBatch(texts: string[], sourceLang: string): Promise<string[]> {
    const request = translationService.TranslateRequest.fromPartial({
      folderId: this.folderId ?? undefined,
      texts,
      sourceLanguageCode: sourceLang,
      targetLanguageCode: this.cfg.targetLang,
      // HTML mode preserves the `<mN></mN>` markup sentinels verbatim.
      format: translationService.TranslateRequest_Format.HTML,
      glossaryConfig: this.glossaryConfigFor(texts),
    });

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.client!.translate(request);
        // HTML mode escapes literal `<`, `>`, `&` in the text content (the
        // `<mN>` sentinels come back as real tags, untouched); decode them back.
        return response.translations.map((t) => decodeHtmlEntities(t.text));
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
        await delay(backoffMs(attempt));
      }
    }
  }

  /**
   * Build the request glossary from the terms that occur across `texts`. Omitted
   * (undefined) when none apply, so a request without glossary terms is plain.
   */
  private glossaryConfigFor(texts: string[]) {
    const pairs = glossaryPairsForTexts(texts, this.glossary);
    return pairs.length > 0 ? { glossaryData: { glossaryPairs: pairs } } : undefined;
  }
}

/** A Yandex glossary pair. `exact: false` lets the neuroglossary inflect the RU term. */
export interface YandexGlossaryPair {
  sourceText: string;
  translatedText: string;
  exact: boolean;
}

/**
 * The deduplicated union of glossary terms occurring across a batch of texts,
 * capped at Yandex's 50-pair limit, as `{sourceText, translatedText, exact}`.
 * `exact: false` so Yandex declines each RU term to fit grammar (indeclinable
 * terms simply pass through unchanged).
 */
export function glossaryPairsForTexts(
  texts: string[],
  glossary: ReadonlyMap<string, string>,
): YandexGlossaryPair[] {
  if (glossary.size === 0) return [];
  const union = new Map<string, string>();
  for (const text of texts) {
    for (const { en, ru } of matchGlossary(text, glossary)) union.set(en, ru);
  }
  return [...union.entries()]
    .slice(0, MAX_GLOSSARY_PAIRS)
    .map(([sourceText, translatedText]) => ({ sourceText, translatedText, exact: false }));
}

/**
 * Decode the HTML entities Yandex's HTML translate mode emits for literal
 * `<`, `>`, `&`, quotes and numeric refs in the text content. `&amp;` is
 * decoded last so a source `&gt;` (arriving as `&amp;gt;`) survives as `&gt;`.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0*39);/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Split texts into batches under both a character budget and a count cap. */
export function batchByChars(texts: string[], charBudget: number, maxTexts: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    const len = text.length;
    if (current.length > 0 && (chars + len > charBudget || current.length >= maxTexts)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
