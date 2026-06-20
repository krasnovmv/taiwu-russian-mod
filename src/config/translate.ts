/**
 * Length-based engine routing threshold.
 *
 * Units up to {@link ROUTING_THRESHOLD} characters are translated by the fast
 * machine engine (Yandex); longer units go to the local LLM (LM Studio), which
 * handles long, markup-heavy prose and declension far better. Run both with
 * `translate --route`.
 *
 * This is PURE routing — it only chooses the engine, it does NOT gate apply:
 * everything translated (short or long) is applied to `Language_RU`.
 *
 * Changing it re-routes units across the boundary: on the next run a unit whose
 * stored engine no longer matches its routed engine is re-translated (cache-first,
 * so it is free if that engine already has it). The threshold is never baked into
 * the source hash, so it triggers no blanket re-translation.
 *
 * Edit the constant below, or override with `TAIWU_ROUTING_THRESHOLD`.
 */
const DEFAULT_ROUTING_THRESHOLD = 40;

const envValue = Number(process.env.TAIWU_ROUTING_THRESHOLD);
export const ROUTING_THRESHOLD =
  Number.isFinite(envValue) && envValue > 0 ? envValue : DEFAULT_ROUTING_THRESHOLD;
