/**
 * Glossary version — the manual "re-translate everything" nuke lever.
 *
 * A unit's `srcHash` now folds in only the glossary terms that actually occur in
 * its text (see `glossarySalt`), so editing one term re-translates exactly the
 * texts containing it — you normally DON'T bump this. Bumping it salts every
 * unit at once, invalidating every *machine* translation in the TM (`reviewed`/
 * `locked` are still left alone) — reserve it for changes that touch how *all*
 * text is translated (engine swap, prompt/style overhaul), not term edits.
 *
 * The glossary content (wuxia terminology) lives in `data/glossary.json5`.
 */
export const GLOSSARY_VERSION = 10;
