/**
 * Hand-maintained repairs for markup defects the game devs shipped in the
 * source text itself (truncated/doubled/fused tags). Applied by `alignFile`
 * right after extraction, so EVERYTHING downstream — masking, srcHash, cache
 * keys, markup-parity validation, the TM and apply — sees the repaired text.
 * Repairing at any later layer is impossible: markup parity is checked against
 * the source, so a translation can never carry a tag the source lacks.
 *
 * Each fix is an exact-substring replacement scoped to one unit and language
 * field. When the substring no longer matches (the devs fixed their text
 * upstream), the fix is reported via the aligned file's `warnings` so the stale
 * entry can be deleted.
 *
 * Gender tags (`str=GenderObject/` etc.) resolve to the localized
 * `LK_Common_Him`/`LK_Common_Her` strings from `ui_language`, so a repaired tag
 * renders a Russian pronoun in game — provided those units are translated in
 * the right grammatical case (hand-fixed "him"→"его" entries in the Yandex
 * cache; the TM rebuilds from them).
 */
import type { SourceUnit } from "../formats/adapter.js";

export interface SourceFix {
  /** Unit key within the file. */
  key: string;
  /** Which field of the unit the fix applies to. */
  lang: "en" | "cn";
  /** Exact defective substring that must occur in the field. */
  from: string;
  /** Replacement text. */
  to: string;
}

/** Fixes keyed by pipeline file id (as passed to `alignFile`). */
export const SOURCE_FIXES: ReadonlyMap<string, readonly SourceFix[]> = new Map([
  [
    "Event_Languages/Taiwu_EventPackage_Adventure_Interact_Wedding_Language_EN.txt",
    [
      // Doubled bracket before the bride's name tag (present in EN and CN).
      {
        key: "a6d79d6f-e4c2-4f7f-990a-fe7f6e326148/EventContent",
        lang: "en",
        from: "<<Character key=Character2 str=Name />",
        to: "<Character key=Character2 str=Name />",
      },
      {
        key: "a6d79d6f-e4c2-4f7f-990a-fe7f6e326148/EventContent",
        lang: "cn",
        from: "<<Character key=Character2 str=Name />",
        to: "<Character key=Character2 str=Name />",
      },
    ],
  ],
  [
    "Event_Languages/Taiwu_EventPackage_SectMainStoryNewEmeiPrelude_Language_EN.txt",
    [
      // Doubled bracket on the opening speaker tag (present in EN and CN).
      {
        key: "00c1c9bb-a2a4-4422-8a64-955d7b8fd344/EventContent",
        lang: "en",
        from: "<<CharacterOrActor key=CharId str=Name/>",
        to: "<CharacterOrActor key=CharId str=Name/>",
      },
      {
        key: "00c1c9bb-a2a4-4422-8a64-955d7b8fd344/EventContent",
        lang: "cn",
        from: "<<CharacterOrActor key=CharId str=Name/>",
        to: "<CharacterOrActor key=CharId str=Name/>",
      },
    ],
  ],
  [
    "Event_Languages/Taiwu_EventPackage_SectMainStoryShixiang_Language_EN.txt",
    // Three options truncated mid-tag: `<Character key=CharacterId
    // str=GenderObject/...)` — the closing `>` is missing, so the whole "tag"
    // was plain text to the parser (and the machine RU collapsed to a stub).
    // CN has no tag here (其 is plain text), so only EN needs the repair.
    [
      "129ede5d-1a19-4a8c-b2e6-7f749cdf82d5",
      "29e9fb23-5f1a-406e-918e-89ba0f5382f1",
      "023d6836-1e9e-4175-9999-775329806013",
    ].map((id) => ({
      key: `${id}/Option_1`,
      lang: "en" as const,
      from: "str=GenderObject/...",
      to: "str=GenderObject/>...",
    })),
  ],
  [
    "Event_Languages/Taiwu_EventPackage_LoongDLC_Language_EN.txt",
    [
      // `<NL>` fused with the following word; the unterminated `<` swallowed a
      // whole sentence into one "tag", which then rode through translation as
      // an opaque token (untranslated English in the RU output).
      {
        key: "57c083e8-73db-4426-9320-cc07d5fc3189/EventContent",
        lang: "en",
        from: "<NLThose who pass through",
        to: "<NL>Those who pass through",
      },
    ],
  ],
]);

/**
 * Apply the configured fixes for `file` to `units` in place-of (returns new
 * unit objects; unaffected units are passed through unchanged). A fix whose
 * substring is absent — upstream repaired the text, or the unit vanished — adds
 * a warning instead, so stale entries surface in every run's report.
 */
export function applySourceFixes(
  file: string,
  units: SourceUnit[],
  warnings: string[],
): SourceUnit[] {
  const fixes = SOURCE_FIXES.get(file);
  if (!fixes) return units;

  const byKey = new Map<string, SourceFix[]>();
  for (const f of fixes) {
    const list = byKey.get(f.key);
    if (list) list.push(f);
    else byKey.set(f.key, [f]);
  }

  const seen = new Set<string>();
  const out = units.map((unit) => {
    const unitFixes = byKey.get(unit.key);
    if (!unitFixes) return unit;
    seen.add(unit.key);
    let { en, cn } = unit;
    for (const f of unitFixes) {
      const target = f.lang === "en" ? en : cn;
      if (target === null || !target.includes(f.from)) {
        warnings.push(
          `source fix did not match (${f.lang} of ${unit.key}): ` +
            `"${f.from}" not found — upstream fixed? remove the entry from source-fixes.ts`,
        );
        continue;
      }
      if (f.lang === "en") en = en.replace(f.from, f.to);
      else cn = cn!.replace(f.from, f.to);
    }
    return { ...unit, en, cn };
  });

  for (const key of byKey.keys()) {
    if (!seen.has(key)) {
      warnings.push(
        `source fix targets missing unit ${key} — remove the entry from source-fixes.ts`,
      );
    }
  }
  return out;
}
