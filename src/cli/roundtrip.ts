/**
 * Standalone round-trip checker — a human-friendly summary over every `.txt`
 * file in the language directory. Reports byte-mismatches and pairing warnings.
 *
 *   npm run roundtrip
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { languageDir } from "../config/paths.js";
import { isMultilineValueFile } from "../config/known-issues.js";
import { parsePairs, parseRaw, serializeRaw } from "../formats/paired-txt.js";

async function main(): Promise<void> {
  const files = (await readdir(languageDir)).filter((f) => f.endsWith(".txt")).sort();
  console.log(`Scanning ${files.length} .txt files in ${languageDir}\n`);

  let mismatches = 0;
  let unexpected = 0;
  let quarantined = 0;
  let totalPairs = 0;

  for (const file of files) {
    const content = await readFile(path.join(languageDir, file), "utf8");
    const restored = serializeRaw(parseRaw(content));
    if (restored !== content) {
      mismatches++;
      console.error(`  ✗ BYTE MISMATCH: ${file}`);
    }
    const { entries, warnings } = parsePairs(content);
    totalPairs += entries.length;
    if (isMultilineValueFile(file)) {
      quarantined++;
      console.log(`  ~ quarantined (multiline values): ${file}`);
    } else if (warnings.length > 0) {
      unexpected++;
      console.error(`  ! ${file}`);
      for (const w of warnings) console.error(`      ${w}`);
    }
  }

  console.log(`\nPairs (translation units): ${totalPairs.toLocaleString("en-US")}`);
  console.log(`Byte mismatches: ${mismatches}`);
  console.log(`Quarantined multiline files: ${quarantined}`);
  console.log(`Files with unexpected warnings: ${unexpected}`);

  if (mismatches > 0 || unexpected > 0) {
    process.exitCode = 1;
    console.error("\nFAILED — see issues above.");
  } else {
    console.log("\nOK — all files round-trip byte-identical; only known multiline files quarantined.");
  }
}

await main();
