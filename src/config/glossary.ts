/**
 * Glossary version. Bumping this number invalidates every *machine* translation
 * in the translation memory (their `srcHash` stops matching), forcing a re-run
 * with the updated terminology while leaving `reviewed`/`locked` units alone.
 *
 * The glossary content itself (wuxia terminology) is introduced in Phase 3.
 */
export const GLOSSARY_VERSION = 0;
