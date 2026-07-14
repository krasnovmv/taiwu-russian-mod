import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { languageCnDir, languageDir } from "../src/config/paths.js";
import { isMultilineValueFile } from "../src/config/known-issues.js";
import { anchoredTxtAdapter } from "../src/formats/anchored-txt.js";
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
    // Quarantined files may break strict alternation (values with real newlines),
    // so the registry routes them to the anchored adapter instead. Whether a given
    // game build actually ships multi-line values there is not ours to decide — a
    // patch can clean them up and later reintroduce them. What must hold either way
    // is that the adapter they are routed to parses them against the CN oracle and
    // rebuilds them byte-for-byte.
    test(`quarantined file survives the anchored adapter: ${file}`, async () => {
      const en = await readFile(path.join(languageDir, file), "utf8");
      const cn = await readFile(path.join(languageCnDir, file), "utf8");
      const { units, warnings } = anchoredTxtAdapter.extract(en, cn);
      assert.deepEqual(warnings, []);
      assert.ok(units.length > 0, `no units extracted from ${file}`);
      const identity = anchoredTxtAdapter.apply(en, new Map(units.map((u) => [u.key, u.en])));
      assert.equal(identity.guardOk, true);
      assert.equal(identity.content, en);
    });
  } else {
    test(`no pairing warnings: ${file}`, async () => {
      const content = await readFile(path.join(languageDir, file), "utf8");
      const { warnings } = parsePairs(content);
      assert.deepEqual(warnings, [], `${file}:\n  ${warnings.join("\n  ")}`);
    });
  }
}
