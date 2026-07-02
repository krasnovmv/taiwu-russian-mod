import path from "node:path";

import { cacheDir } from "../config/paths.js";
import { loadGlossary, loadGlossaryFeeds } from "../glossary/load.js";
import { markupPreserved } from "./protect.js";
import { CachingEngine } from "./caching.js";
import { LmStudioEngine } from "./lmstudio.js";
import { MockEngine } from "./mock.js";
import type { TranslationEngine } from "./types.js";
import { YandexEngine } from "./yandex.js";

export type EngineId = "mock" | "yandex" | "lmstudio";

const ENGINE_IDS: ReadonlySet<string> = new Set(["mock", "yandex", "lmstudio"]);

/** Parse an engine id from CLI input, defaulting to `mock`. */
export function parseEngineId(value: string | undefined): EngineId {
  return value && ENGINE_IDS.has(value) ? (value as EngineId) : "mock";
}

function cacheFile(id: EngineId): string {
  return path.join(cacheDir, `${id}.jsonl`);
}

/**
 * Construct an engine by id. The Yandex and LM Studio engines are wrapped in a
 * {@link CachingEngine} so identical source strings are translated once and
 * never re-billed/re-run (the cache survives deleting the translation memory).
 * `mock` is free/deterministic and left unwrapped.
 *
 * The glossary is loaded once and handed to both the engine (which applies it —
 * Yandex via `glossaryConfig`, LM Studio via the prompt) and the cache (which
 * folds matched terms into its key). `mock` ignores the glossary.
 */
export async function createEngine(
  id: EngineId,
  opts: { cacheOnly?: boolean } = {},
): Promise<TranslationEngine> {
  if (id === "mock") return new MockEngine();
  const glossary = await loadGlossary();
  // Dot-breaking surrogates are a Yandex-only workaround (its neuroglossary
  // segments on the abbreviation period); LM Studio handles the raw term via the
  // prompt, so it neither needs nor keys on them.
  const feeds = id === "yandex" ? await loadGlossaryFeeds() : undefined;
  const inner =
    // Credentials come from the `yc` CLI, resolved lazily on first use.
    id === "yandex" ? YandexEngine.fromEnv(glossary, feeds) : LmStudioEngine.fromEnv(glossary);
  return new CachingEngine(
    inner,
    cacheFile(id),
    glossary,
    markupPreserved,
    opts.cacheOnly ?? false,
    feeds,
  );
}
