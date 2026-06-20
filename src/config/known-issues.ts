/**
 * Files that violate the strict key/value alternation assumed by the
 * paired-`.txt` adapter, because some values contain *real* newlines (rather
 * than the usual `<NL>` token) and therefore span multiple physical lines.
 *
 * These were discovered in Phase 1 by the desync detector. They are quarantined
 * from naive alternation parsing/translation until handled explicitly — the
 * planned approach is to use the CN file as a structural oracle to recover true
 * key boundaries (key sequences are shared across languages).
 *
 * Their *raw* round-trip is still byte-exact, so they are never corrupted; they
 * are simply not auto-translated yet.
 */
export const MULTILINE_VALUE_FILES: ReadonlySet<string> = new Set([
  "CricketPolymorphEvent_language.txt",
  "ImplementedDlc_language.txt",
]);

/** True if a file is known to break strict key/value alternation. */
export function isMultilineValueFile(fileName: string): boolean {
  return MULTILINE_VALUE_FILES.has(fileName);
}
