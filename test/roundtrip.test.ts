import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { languageDir } from "../src/config/paths.js";
import { isMultilineValueFile } from "../src/config/known-issues.js";
import { parsePairs, parseRaw, serializeRaw } from "../src/formats/paired-txt.js";

/**
 * Golden test: for every real `.txt` file in the language directory, prove that
 * we can parse and re-serialize it byte-for-byte, and that the semantic pairing
 * never desyncs. This is the safety net that makes in-place writing acceptable.
 */
const txtFiles = (await readdir(languageDir)).filter((f) => f.endsWith(".txt")).sort();

test(`language dir contains .txt files (${languageDir})`, () => {
  assert.ok(txtFiles.length > 0, `no .txt files found in ${languageDir}`);
});

for (const file of txtFiles) {
  test(`round-trip byte-identical: ${file}`, async () => {
    const content = await readFile(path.join(languageDir, file), "utf8");
    assert.equal(serializeRaw(parseRaw(content)), content);
  });

  if (isMultilineValueFile(file)) {
    // Quarantined files are expected to break strict alternation — assert that
    // the detector still flags them, so the quarantine stays justified.
    test(`quarantined file is detected as desynced: ${file}`, async () => {
      const content = await readFile(path.join(languageDir, file), "utf8");
      const { warnings } = parsePairs(content);
      assert.ok(warnings.length > 0, `expected desync warnings for ${file}`);
    });
  } else {
    test(`no pairing warnings: ${file}`, async () => {
      const content = await readFile(path.join(languageDir, file), "utf8");
      const { warnings } = parsePairs(content);
      assert.deepEqual(warnings, [], `${file}:\n  ${warnings.join("\n  ")}`);
    });
  }
}
