/**
 * Public entry point for the Taiwu localization toolkit.
 *
 * Phase 1 exposes the paired-`.txt` format layer; Phase 2 adds bilingual
 * EN↔CN alignment and the translation-memory model/store. The translation
 * engine and remaining format adapters are added in later phases.
 */
export * from "./model/types.js";
export * from "./model/tm.js";
export * as pairedTxt from "./formats/paired-txt.js";
export * from "./align/bilingual.js";
export * from "./tm/hash.js";
export * from "./tm/store.js";
export * from "./tm/coverage.js";
export * from "./scan.js";
export { languageDir, languageCnDir, tmDir, projectRoot } from "./config/paths.js";
export { GLOSSARY_VERSION } from "./config/glossary.js";
