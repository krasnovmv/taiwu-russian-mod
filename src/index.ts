/**
 * Public entry point for the Taiwu localization toolkit.
 *
 * Phase 1 exposes only the paired-`.txt` format layer; the translation engine,
 * translation memory and CLI commands are added in later phases.
 */
export * from "./model/types.js";
export * as pairedTxt from "./formats/paired-txt.js";
export { languageDir, languageCnDir, projectRoot } from "./config/paths.js";
