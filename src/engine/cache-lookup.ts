/**
 * Read-only lookup of an engine's raw output for a source text.
 *
 * The engine cache (`cache/<engine>.jsonl`) stores the MASKED text a translator
 * was given against the MASKED translation it returned. This walks that path
 * backwards for one EN string: mask it exactly as the pipeline does, build the
 * same cache key ({@link cacheKeyFor}), and restore the sentinels in the hit.
 * The result is the raw machine translation — the text the TM held before any
 * later edit.
 *
 * The LLM judge uses it to show itself where a translation came from: a unit it
 * already fixed once holds the previous judge's wording, not the engine's, so
 * without this a second pass would silently judge the first pass's output and let
 * rewrites pile up on top of each other. With it, the judge sees both and can
 * just as well decide the machine had it right all along.
 */
import path from "node:path";

import { cacheDir } from "../config/paths.js";
import { loadGlossary, loadGlossaryFeeds } from "../glossary/load.js";
import { cacheKeyFor, readCacheFile, usableOutput } from "./caching.js";
import { mask, restore } from "./protect.js";

export class EngineCache {
  private constructor(
    private readonly entries: Map<string, string>,
    private readonly glossary: ReadonlyMap<string, string>,
    private readonly feeds: ReadonlyMap<string, string> | undefined,
  ) {}

  /**
   * Load the cache of `engineId`, or null when that engine keeps none (`mock`,
   * `neutral`) or its file doesn't exist yet. Dot-breaking surrogates (`feeds`)
   * are folded into Yandex keys only — mirroring `engine/factory.ts`.
   */
  static async forEngine(engineId: string): Promise<EngineCache | null> {
    if (engineId !== "yandex" && engineId !== "lmstudio") return null;
    const file = path.join(cacheDir, `${engineId}.jsonl`);
    // Same usability rule as the engine cache itself: never show the judge an
    // "engine translation" that is really the untranslated Chinese source.
    const { entries } = await readCacheFile(file, usableOutput);
    if (entries.size === 0) return null;
    const feeds = engineId === "yandex" ? await loadGlossaryFeeds() : undefined;
    return new EngineCache(entries, await loadGlossary(), feeds);
  }

  /** The engine's translation of `en`, or null on a miss / unrestorable entry. */
  lookup(en: string): string | null {
    const masked = mask(en);
    if (!masked.translatable) return null;
    const hit = this.entries.get(cacheKeyFor(masked.masked, this.glossary, this.feeds));
    if (hit === undefined) return null;
    const restored = restore(hit, masked);
    return restored.ok ? restored.text : null;
  }
}
