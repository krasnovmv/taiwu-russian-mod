/**
 * Pairing the rows of an EN encyclopedia table with the rows of its CN twin.
 *
 * The obvious pairing — row `r` with row `r` — is wrong, and was wrong in the
 * shipped extractor for a long time. The game's language packs are not row-for-row
 * copies of each other: `EncyclopediaContent.tsv` has an entry
 * (`门派-门派概述-门派支持14`) that the Chinese file simply does not have, so from
 * that row on every EN row sat beside the NEXT entry's Chinese. Nothing caught it
 * because the files still had the same number of rows overall — the surplus and
 * the shortfall cancelled out — and because a mismatched pair looks perfectly
 * well-formed. Measured by the tables' own row ids, 61% of that file's rows were
 * paired with the wrong Chinese, and `EncyclopediaReference.tsv` (which differs by
 * four rows outright) was worse.
 *
 * That is not a cosmetic problem: the CN text is the judge's MEANING OF RECORD, so
 * a misaligned row makes it "correct" the Russian into a translation of a
 * different entry — and those rewrites pass the QA gates whenever the neighbour
 * happens to carry the same markup.
 *
 * ## How the rows are matched instead
 *
 * These tables carry columns that are the SAME text in every language — internal
 * ids and paths (`表Buzhuodian`, `门派-门派一览-空桑派-特有功能4`), enum
 * placeholders, bare numbers. {@link anchorColumns} finds them without assuming
 * any alignment to begin with: it compares the two files' multisets of values for
 * a column, which agree only if the column is language-independent. A column of
 * prose scores near zero, an id column near one.
 *
 * Those columns make a per-row key, and rows are matched on it by a patience-style
 * diff: pair up the keys that occur exactly ONCE on each side, keep the longest
 * run of them that stays in order, then fill each gap between two anchors
 * positionally — but only when the gap is the same length on both sides, since a
 * gap that is not is exactly where an entry was added or removed.
 *
 * A table with no language-independent column at all (small, fully translated
 * ones) keeps positional pairing: there is nothing better to go on, and those
 * tables measured clean.
 *
 * Whatever the pairing, {@link alignCnRows} then drops any pair whose markup does
 * not match, because two rows describing the same entry carry the same tags. An
 * unmatched or rejected row yields `null`, which surfaces as "CHINESE: (absent)"
 * in the judge prompt — no reference is strictly better than a confident wrong one.
 */

/**
 * How much of a column's values must be shared for it to identify rows.
 *
 * The two populations are nowhere near each other, which is what makes this
 * robust: an id column scores ~1.0 and a translated column scores ~0.0 — there is
 * nothing in between to misclassify. So the bar sits in the middle rather than
 * near 1.0. Set high, a table that merely LOST a few entries in one language
 * would fail to recognise its own id column and fall back to the positional
 * pairing this module exists to replace — the failure mode being fixed here.
 */
const ANCHOR_MIN_OVERLAP = 0.5;
/** …and only a column that most rows actually fill can anchor them. */
const ANCHOR_MIN_COVERAGE = 0.5;

const TAG_RE = /<[^>]*>/g;
const TAG_NAME_RE = /^<\s*(\/?)\s*([a-zA-Z]+)/;
const LINK_RE = /link="([^"]*)"/;

/**
 * The markup skeleton of a row: the sequence of tag names, plus the ids of any
 * `link="…"` (which name a game entry and so read the same in every language).
 * Two rows describing one entry share it.
 *
 * Deliberately NOT the tags verbatim. Some attribute values legitimately differ
 * between the packs — `Cuzhi_Teshu.tsv` grades a cricket `<color=#GradeColor_8>`
 * in English and `<color=#GradeColor_0>` in Chinese for the very same row — and
 * comparing those threw away 27 of that table's 31 perfectly good pairs.
 */
function fingerprint(row: string[]): string {
  const tags = row.join("\t").match(TAG_RE) ?? [];
  return tags
    .map((tag) => {
      const name = TAG_NAME_RE.exec(tag);
      const link = LINK_RE.exec(tag);
      return `${name ? `${name[1]}${name[2]}` : tag}${link ? `=${link[1]}` : ""}`;
    })
    .join("|");
}

/**
 * How much of `a`'s values `b` also holds, counting duplicates once each — 1 when
 * `b` contains every value of `a`, near 0 when the two share nothing.
 */
function multisetOverlap(a: string[], b: string[]): number {
  if (a.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const v of b) pool.set(v, (pool.get(v) ?? 0) + 1);
  let hits = 0;
  for (const v of a) {
    const left = pool.get(v) ?? 0;
    if (left > 0) {
      hits++;
      pool.set(v, left - 1);
    }
  }
  return hits / a.length;
}

/**
 * The columns that read the same in both languages, and so can identify a row.
 * Decided by value multisets, NOT by comparing row `r` with row `r` — the whole
 * point is that we cannot trust that correspondence yet.
 */
export function anchorColumns(enRows: string[][], cnRows: string[][]): number[] {
  const width = Math.max(0, ...enRows.map((r) => r.length));
  const out: number[] = [];
  for (let c = 0; c < width; c++) {
    const en = enRows.map((r) => r[c] ?? "").filter(Boolean);
    const cn = cnRows.map((r) => r[c] ?? "").filter(Boolean);
    if (en.length < enRows.length * ANCHOR_MIN_COVERAGE) continue;
    if (multisetOverlap(en, cn) >= ANCHOR_MIN_OVERLAP) out.push(c);
  }
  return out;
}

/** Indices of the longest strictly increasing subsequence of `values`. */
function longestIncreasing(values: number[]): number[] {
  // Patience sorting: `tails[k]` is the index of the smallest value that can end
  // an increasing run of length k+1; `prev` threads the chosen run back together.
  const tails: number[] = [];
  const prev = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[tails[mid] as number] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] as number;
    tails[lo] = i;
  }
  const out: number[] = [];
  let k = tails.length > 0 ? (tails[tails.length - 1] as number) : -1;
  while (k >= 0) {
    out.push(k);
    k = prev[k] as number;
  }
  return out.reverse();
}

/**
 * For every EN row, the CN row describing the same entry — or `null` when there is
 * none, or when the pairing cannot be trusted. Always the same length as `enRows`.
 */
export function alignCnRows(enRows: string[][], cnRows: string[][]): (string[] | null)[] {
  if (cnRows.length === 0) return enRows.map(() => null);

  const anchors = anchorColumns(enRows, cnRows);
  const paired: (string[] | null)[] =
    anchors.length === 0
      ? enRows.map((_, r) => cnRows[r] ?? null)
      : matchByKey(enRows, cnRows, (row) => anchors.map((c) => row[c] ?? "").join(""));

  // Two rows of one entry carry the same tags. Where they do not, the pairing is
  // wrong however it was arrived at, and a wrong reference is worse than none.
  return paired.map((cn, r) =>
    cn && fingerprint(enRows[r] as string[]) === fingerprint(cn) ? cn : null,
  );
}

/** Patience-style row matching on `key`; see the module comment. */
function matchByKey(
  enRows: string[][],
  cnRows: string[][],
  key: (row: string[]) => string,
): (string[] | null)[] {
  const index = (rows: string[][]): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    rows.forEach((row, i) => {
      const k = key(row);
      const at = m.get(k);
      if (at) at.push(i);
      else m.set(k, [i]);
    });
    return m;
  };
  const enAt = index(enRows);
  const cnAt = index(cnRows);

  // Anchors: keys that name exactly one row on each side, so the pairing is not a
  // guess. Keeping only the longest in-order run of them drops the few that would
  // require the tables to have been reordered rather than edited.
  const candidates: { en: number; cn: number }[] = [];
  for (const [k, ens] of enAt) {
    const cns = cnAt.get(k);
    if (ens.length === 1 && cns?.length === 1) {
      candidates.push({ en: ens[0] as number, cn: cns[0] as number });
    }
  }
  candidates.sort((a, b) => a.en - b.en);
  const kept = longestIncreasing(candidates.map((c) => c.cn)).map(
    (i) => candidates[i] as { en: number; cn: number },
  );

  const out = new Array<string[] | null>(enRows.length).fill(null);
  let enPrev = -1;
  let cnPrev = -1;
  const fillGap = (enEnd: number, cnEnd: number): void => {
    // Between two anchors the rows are unidentifiable on their own. Equal-sized
    // gaps line up one to one; unequal ones are where an entry was inserted or
    // dropped, and guessing there is what caused the bug in the first place.
    if (enEnd - enPrev !== cnEnd - cnPrev) return;
    for (let i = enPrev + 1, j = cnPrev + 1; i < enEnd; i++, j++) {
      out[i] = cnRows[j] ?? null;
    }
  };
  for (const anchor of kept) {
    fillGap(anchor.en, anchor.cn);
    out[anchor.en] = cnRows[anchor.cn] ?? null;
    enPrev = anchor.en;
    cnPrev = anchor.cn;
  }
  fillGap(enRows.length, cnRows.length);
  return out;
}
