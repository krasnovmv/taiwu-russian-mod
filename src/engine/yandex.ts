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

import { backoffMs, delay } from "../util/async.js";
import type { ProgressCallback, TranslationEngine, TranslationRequest } from "./types.js";
import { ycFolderId, ycIamToken } from "./yc.js";

const CHAR_BUDGET = 9000;
const MAX_TEXTS = 100;
const MAX_RETRIES = 5;

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
}

export class YandexEngine implements TranslationEngine {
  readonly id = "yandex";
  readonly checkpointSize = 100; // fast batched MT; whole files complete quickly
  private readonly cfg: Required<Pick<YandexConfig, "sourceLang" | "targetLang">> & YandexConfig;
  private client: ReturnType<typeof createTranslationClient> | null = null;
  private folderId: string | null = null;

  constructor(cfg: YandexConfig) {
    this.cfg = { sourceLang: "en", targetLang: "ru", ...cfg };
  }

  /**
   * Default engine: credentials always come from the `yc` CLI
   * (`yc iam create-token` / `yc config get folder-id`), resolved lazily on the
   * first translate so a missing/uninitialized CLI surfaces a clear error only
   * when translation actually runs. Inject providers via the constructor to test
   * or to source credentials differently.
   */
  static fromEnv(): YandexEngine {
    return new YandexEngine({ getIamToken: ycIamToken, getFolderId: ycFolderId });
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
    // Yandex is pure machine translation; the CN reference is not used.
    const texts = requests.map((r) => r.text);
    const result: string[] = [];
    for (const batch of batchByChars(texts, CHAR_BUDGET, MAX_TEXTS)) {
      result.push(...(await this.translateBatch(batch)));
      onProgress?.(result.length);
    }
    return result;
  }

  private async translateBatch(texts: string[]): Promise<string[]> {
    const request = translationService.TranslateRequest.fromPartial({
      folderId: this.folderId ?? undefined,
      texts,
      sourceLanguageCode: this.cfg.sourceLang,
      targetLanguageCode: this.cfg.targetLang,
      // HTML mode preserves the `<mN></mN>` markup sentinels verbatim.
      format: translationService.TranslateRequest_Format.HTML,
    });

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.client!.translate(request);
        return response.translations.map((t) => t.text);
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
        await delay(backoffMs(attempt));
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
