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

import type { TranslationEngine, TranslationRequest } from "./types.js";

const CHAR_BUDGET = 9000;
const MAX_TEXTS = 100;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

export interface YandexConfig {
  iamToken: string;
  folderId: string;
  sourceLang?: string;
  targetLang?: string;
}

export class YandexEngine implements TranslationEngine {
  readonly id = "yandex";
  private readonly client;
  private readonly folderId: string;
  private readonly sourceLang: string;
  private readonly targetLang: string;

  constructor(cfg: YandexConfig) {
    const session = new Session({ iamToken: cfg.iamToken });
    this.client = session.client(translationService.TranslationServiceClient);
    this.folderId = cfg.folderId;
    this.sourceLang = cfg.sourceLang ?? "en";
    this.targetLang = cfg.targetLang ?? "ru";
  }

  /** Build from environment, or return null if credentials are missing. */
  static fromEnv(): YandexEngine | null {
    const iamToken = process.env.TAIWU_YANDEX_IAM_TOKEN;
    const folderId = process.env.TAIWU_YANDEX_FOLDER_ID;
    if (!iamToken || !folderId) return null;
    return new YandexEngine({ iamToken, folderId });
  }

  async translate(requests: TranslationRequest[]): Promise<string[]> {
    // Yandex is pure machine translation; the CN reference is not used.
    const texts = requests.map((r) => r.text);
    const result: string[] = [];
    for (const batch of batchByChars(texts, CHAR_BUDGET, MAX_TEXTS)) {
      result.push(...(await this.translateBatch(batch)));
    }
    return result;
  }

  private async translateBatch(texts: string[]): Promise<string[]> {
    const request = translationService.TranslateRequest.fromPartial({
      folderId: this.folderId,
      texts,
      sourceLanguageCode: this.sourceLang,
      targetLanguageCode: this.targetLang,
      format: translationService.TranslateRequest_Format.PLAIN_TEXT,
    });

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.client.translate(request);
        return response.translations.map((t) => t.text);
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
        await delay(BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
