/**
 * Sync the glossary with a shared CSV (e.g. a Google Sheet published as CSV).
 * Import and export are inverse operations: the CSV is the source of truth, and
 * `data/glossary.json5` is rebuilt to mirror it exactly — row order, additions,
 * edited translations, and deletions all flow through 1:1.
 *
 *   npm run glossary:pull -- --export data/glossary.csv   # glossary → CSV (seed the sheet)
 *   npm run glossary:pull                                 # $GLOSSARY_CSV_URL → glossary
 *   npm run glossary:pull -- --url <csv-url>              # explicit CSV URL → glossary
 *   npm run glossary:pull -- --file downloaded.csv        # local CSV → glossary (no network)
 *   npm run glossary:pull -- --dry-run                    # show the diff, write nothing
 *
 * The rebuild is a MIRROR: whatever the sheet says wins. Existing `_comment`
 * metadata is preserved and a round-trip export→import with no edits produces an
 * identical file. The pure CSV↔glossary logic lives in src/glossary/sheet.ts.
 *
 * After a write, run `npm run rebuild-tm` — a term edit re-hashes and re-translates
 * only the units containing it; no GLOSSARY_VERSION bump.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import JSON5 from "json5";

import { projectRoot } from "../config/paths.js";
import {
  buildFile,
  countTerms,
  diffGlossary,
  flattenSheet,
  glossaryToCsv,
  parseSheet,
  type GlossaryValue,
} from "../glossary/sheet.js";

const glossaryPath = path.join(projectRoot, "data", "glossary.json5");

interface Args {
  url: string | null;
  file: string | null;
  exportPath: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  return {
    url: value("--url") ?? process.env.GLOSSARY_CSV_URL ?? null,
    file: value("--file"),
    exportPath: value("--export"),
    dryRun: argv.includes("--dry-run"),
  };
}

/** Export the current glossary to a CSV suitable for seeding the shared sheet. */
async function exportCsv(outPath: string): Promise<void> {
  const parsed: Record<string, GlossaryValue> = JSON5.parse(await readFile(glossaryPath, "utf8"));
  await writeFile(path.resolve(outPath), glossaryToCsv(parsed), "utf8");
  console.log(`Exported ${countTerms(parsed)} terms → ${outPath}`);
  console.log("Upload this to Google Sheets, then File → Share → Publish to web → CSV.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.exportPath) {
    await exportCsv(args.exportPath);
    return;
  }

  // 1. Get the CSV text.
  let csv: string;
  if (args.file) {
    csv = await readFile(path.resolve(args.file), "utf8");
  } else if (args.url) {
    const res = await fetch(args.url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText} (${args.url})`);
    csv = await res.text();
  } else {
    throw new Error(
      "No source. Pass --file <path>, --url <csv-url>, or set GLOSSARY_CSV_URL. " +
        "First time? Seed the sheet with:  npm run glossary:pull -- --export data/glossary.csv",
    );
  }

  const sheet = parseSheet(csv);
  const raw = await readFile(glossaryPath, "utf8");
  const existing: Record<string, GlossaryValue> = JSON5.parse(raw);

  // Safety: never wipe the glossary from an empty/broken fetch.
  if (flattenSheet(sheet).length === 0) {
    throw new Error(
      "Sheet has no terms — refusing to overwrite the glossary. Check the CSV source.",
    );
  }

  // 2. Report the diff.
  const { added, removed, changed } = diffGlossary(existing, sheet);
  console.log(
    `Sheet: ${flattenSheet(sheet).length} terms in ${sheet.sections.length} sections. ` +
      `Changes: +${added.length} added, -${removed.length} removed, ~${changed.length} changed.`,
  );
  if (sheet.invalid.length > 0) {
    console.log(
      `\nSkipped ${sheet.invalid.length} rows missing EN or RU (lines: ` +
        `${sheet.invalid.map((r) => r.line).join(", ")}).`,
    );
  }
  if (sheet.dupes.length > 0) {
    console.log(
      `\nDropped ${sheet.dupes.length} duplicate EN rows (lines: ` +
        `${sheet.dupes.map((d) => d.line).join(", ")}).`,
    );
  }
  const feedNote = (feed: string): string => (feed ? ` (feed: "${feed}")` : "");
  if (added.length > 0) {
    console.log(`\nAdded:`);
    for (const t of added) console.log(`  + "${t.en}" → "${t.ru}"${feedNote(t.feed)}`);
  }
  if (changed.length > 0) {
    console.log(`\nChanged:`);
    for (const c of changed) {
      console.log(`  ~ "${c.to.en}": "${c.from.ru}" → "${c.to.ru}"${feedNote(c.to.feed)}`);
    }
  }
  if (removed.length > 0) {
    console.log(`\nRemoved (present in glossary, absent from sheet):`);
    for (const o of removed) console.log(`  - "${o.en}" → "${o.ru}"`);
  }

  // 3. Rebuild and write.
  const out = buildFile(existing, sheet);
  if (out === raw) {
    console.log("\nGlossary already matches the sheet — nothing to write.");
    return;
  }
  if (args.dryRun) {
    console.log(`\n[dry-run] Would rewrite data/glossary.json5 to mirror the sheet.`);
    return;
  }
  await writeFile(glossaryPath, out, "utf8");
  console.log(`\nRewrote data/glossary.json5 to mirror the sheet.`);
  console.log("Next: run `npm run rebuild-tm` to re-translate the affected units.");
}

await main();
