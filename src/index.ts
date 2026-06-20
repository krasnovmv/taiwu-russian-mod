/**
 * Public entry point for the Taiwu localization toolkit.
 *
 * Engines are exposed only through the `TranslationEngine` interface + the
 * `createEngine` factory (concrete engine classes are intentionally not
 * re-exported, so callers stay decoupled from a specific implementation).
 * Likewise, formats are reached through the `FormatAdapter` interface +
 * `adapterFor` registry.
 */
export * from "./model/types.js";
export * from "./model/tm.js";
export * as pairedTxt from "./formats/paired-txt.js";
export * from "./formats/adapter.js";
export { adapterFor } from "./formats/registry.js";
export * from "./align/bilingual.js";
export * from "./tm/hash.js";
export * from "./tm/store.js";
export * from "./tm/coverage.js";
export * from "./tm/sync.js";
export * from "./scan.js";
export * from "./engine/types.js";
export * from "./engine/protect.js";
export { createEngine, parseEngineId, type EngineId } from "./engine/factory.js";
export * from "./glossary/load.js";
export * from "./translate/pipeline.js";
export * from "./apply/apply.js";
export * from "./validate/qa.js";
export { writeFileAtomic } from "./util/fs.js";
export { languageDir, languageCnDir, languageRuDir, tmDir, projectRoot } from "./config/paths.js";
export { GLOSSARY_VERSION } from "./config/glossary.js";
