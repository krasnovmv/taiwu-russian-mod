/**
 * QA report.
 *
 *   npm run validate                 # checks translated units in the TM
 *   npm run validate -- <file>       # one file
 *   npm run validate -- --kind markup-mismatch
 *   npm run validate -- --semantic   # EN↔CN markup divergence (no TM needed)
 */
import { alignFile } from "../align/bilingual.js";
import { listSourceFiles } from "../scan.js";
import { loadTm } from "../tm/store.js";
import { validateBilingual, validateTm, type IssueKind, type QaIssue } from "../validate/qa.js";
import { Progress } from "./progress.js";

async function collect(files: string[], semantic: boolean): Promise<QaIssue[]> {
  const bar = new Progress(files.length, "validate");
  const all: QaIssue[] = [];
  for (const file of files) {
    if (semantic) {
      const aligned = await alignFile(file);
      all.push(...validateBilingual(file, aligned.units));
    } else {
      const tm = await loadTm(file);
      if (tm) all.push(...validateTm(tm));
    }
    bar.increment(file);
  }
  bar.finish();
  return all;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const semantic = args.includes("--semantic");
  const kindIdx = args.indexOf("--kind");
  const kindFilter = kindIdx >= 0 ? (args[kindIdx + 1] as IssueKind | undefined) : undefined;
  const fileArg = args.find((a) => !a.startsWith("--") && a !== kindFilter);

  const files = fileArg ? [fileArg] : await listSourceFiles();
  const issues = (await collect(files, semantic)).filter(
    (i) => !kindFilter || i.kind === kindFilter,
  );

  const byKind = new Map<string, number>();
  for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);

  const mode = semantic ? "EN↔CN semantic" : "TM";
  console.log(`Checked ${files.length} file(s) [${mode}]; ${issues.length} issue(s).\n`);
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }

  if (issues.length > 0) {
    console.log(`\nSamples:`);
    for (const i of issues.slice(0, 25))
      console.log(`  [${i.kind}] ${i.file} ${i.key}: ${i.detail}`);
    if (issues.length > 25) console.log(`  … and ${issues.length - 25} more`);
    process.exitCode = 1;
  }
}

await main();
