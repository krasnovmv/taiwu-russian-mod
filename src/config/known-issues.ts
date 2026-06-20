/**
 * Files that violate the strict key/value alternation assumed by the
 * paired-`.txt` adapter, because some values contain *real* newlines (rather
 * than the usual `<NL>` token) and therefore span multiple physical lines.
 *
 * Discovered in Phase 1 by the desync detector. The format registry routes them
 * to the {@link anchoredTxtAdapter}, which uses the clean CN file as a structural
 * oracle to recover the true key boundaries. Their raw round-trip is byte-exact.
 */
export const MULTILINE_VALUE_FILES: ReadonlySet<string> = new Set([
  "CricketPolymorphEvent_language.txt",
  "ImplementedDlc_language.txt",
]);

/** True if a file is known to break strict key/value alternation. */
export function isMultilineValueFile(fileName: string): boolean {
  return MULTILINE_VALUE_FILES.has(fileName);
}
