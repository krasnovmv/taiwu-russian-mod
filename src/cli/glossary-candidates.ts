/**
 * Mine the English corpus for glossary candidates — recurring proper nouns and
 * domain terms whose translation should stay consistent across the game.
 *
 *   npm run glossary:candidates                       # top 100 to the console
 *   npm run glossary:candidates -- --min 5 --top 50   # tune thresholds
 *   npm run glossary:candidates -- --phrases          # multi-word terms only
 *   npm run glossary:candidates -- --json out.json    # full ranked report
 *   npm run glossary:candidates -- --skeleton add.json# fill-in stub for top N
 *
 * Reads only the source (`Language_EN` + `Language_CN` for examples); spends no
 * tokens and writes nothing unless --json / --skeleton is given.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { alignFile } from "../align/bilingual.js";
import { collectCandidates, type Candidate, type SourceText } from "../glossary/candidates.js";
import { loadGlossary } from "../glossary/load.js";
import { listSourceFiles } from "../scan.js";
import { Progress } from "./progress.js";

interface Args {
  minCount: number;
  top: number;
  phrasesOnly: boolean;
  jsonPath: string | null;
  skeletonPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (flag: string, fallback: number): number => {
    const v = value(flag);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    minCount: num("--min", 3),
    top: num("--top", 100),
    phrasesOnly: argv.includes("--phrases"),
    jsonPath: value("--json") ?? null,
    skeletonPath: value("--skeleton") ?? null,
  };
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = await listSourceFiles();
  const glossary = await loadGlossary();

  const texts: SourceText[] = [];
  const bar = new Progress(files.length, "scan");
  for (const file of files) {
    const aligned = await alignFile(file);
    for (const u of aligned.units) {
      if (u.en.trim()) texts.push({ file, en: u.en, cn: u.cn });
    }
    bar.increment(file);
  }
  bar.finish();

  let candidates = collectCandidates(texts, {
    minCount: args.minCount,
    includeSingles: !args.phrasesOnly,
    glossary,
  });
  if (args.phrasesOnly) candidates = candidates.filter((c) => c.words >= 2);

  console.log(
    `\nScanned ${texts.length.toLocaleString("en-US")} units across ${files.length} files.`,
  );
  console.log(
    `Found ${candidates.length.toLocaleString("en-US")} candidates ` +
      `(min count ${args.minCount}, ${glossary.size} already in glossary).\n`,
  );

  const shown = candidates.slice(0, args.top);
  const w = Math.max(4, ...shown.map((c) => c.term.length));
  console.log(`${"term".padEnd(w)}  count  files  example`);
  console.log(`${"─".repeat(w)}  ─────  ─────  ${"─".repeat(40)}`);
  for (const c of shown) {
    console.log(
      `${c.term.padEnd(w)}  ${String(c.count).padStart(5)}  ${String(c.files).padStart(5)}  ` +
        truncate(c.example.cn ?? c.example.en, 40),
    );
  }
  if (candidates.length > shown.length) {
    console.log(`\n… and ${candidates.length - shown.length} more (raise --top or use --json).`);
  }

  if (args.jsonPath) {
    const report = candidates.map((c: Candidate) => ({
      term: c.term,
      count: c.count,
      files: c.files,
      words: c.words,
      example: { file: c.example.file, en: c.example.en, cn: c.example.cn },
    }));
    await writeFile(path.resolve(args.jsonPath), JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`\nWrote full report (${report.length} terms) → ${args.jsonPath}`);
  }

  if (args.skeletonPath) {
    // A ready-to-edit EN→RU stub for the top N terms — paste curated entries
    // into data/glossary.json5, then `npm run rebuild-tm` (a term edit re-hashes
    // and re-translates only the units containing it; no GLOSSARY_VERSION bump).
    const stub: Record<string, string> = {};
    for (const c of shown) stub[c.term] = "";
    await writeFile(path.resolve(args.skeletonPath), JSON.stringify(stub, null, 2) + "\n", "utf8");
    console.log(`Wrote fill-in skeleton (${shown.length} terms) → ${args.skeletonPath}`);
  }
}

await main();
