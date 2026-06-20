/**
 * Length-based translation cap.
 *
 * Only source units up to {@link MAX_TRANSLATE_LEN} characters are translated;
 * longer units are left in English (apply emits the source). The cap is a LIVE
 * filter, applied at translate AND apply time — it is NOT baked into the TM or
 * the source hash — so changing it is automatically consistent and lossless:
 *
 *   - raise it  → the next `translate` fills the newly-eligible (shorter) units;
 *   - lower it  → `apply` stops emitting machine translations that are now too
 *                 long, and `status`/`estimate` drop them from the pending work;
 *                 their TM entries are kept and reused if you raise it again.
 *
 * Because it never touches the hash, changing the cap costs no re-translation:
 * already-translated units that stay eligible are untouched. Human-reviewed or
 * locked units are always applied regardless of length.
 *
 * Edit the constant below, or override per run with `TAIWU_MAX_TRANSLATE_LEN`.
 */
const DEFAULT_MAX_TRANSLATE_LEN = 40;

const envValue = Number(process.env.TAIWU_MAX_TRANSLATE_LEN);
export const MAX_TRANSLATE_LEN =
  Number.isFinite(envValue) && envValue > 0 ? envValue : DEFAULT_MAX_TRANSLATE_LEN;

/** True when `en` is short enough to translate/apply under the current cap. */
export function withinLengthCap(en: string): boolean {
  return en.length <= MAX_TRANSLATE_LEN;
}
