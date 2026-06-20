/**
 * QA report over the translation memory.
 *
 *   npm run validate                 # all files
 *   npm run validate -- <file>       # one file
 *   npm run validate -- --kind markup-mismatch
 */
import { listSourceFiles } from "../scan.js";
import { loadTm } from "../tm/store.js";
import { validateTm, type IssueKind, type QaIssue } from "../validate/qa.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const kindIdx = args.indexOf("--kind");
  const kindFilter = kindIdx >= 0 ? (args[kindIdx + 1] as IssueKind | undefined) : undefined;
  const fileArg = args.find((a) => !a.startsWith("--") && a !== kindFilter);

  const files = fileArg ? [fileArg] : await listSourceFiles();

  const all: QaIssue[] = [];
  let withTm = 0;
  for (const file of files) {
    const tm = await loadTm(file);
    if (!tm) continue;
    withTm++;
    for (const issue of validateTm(tm)) {
      if (!kindFilter || issue.kind === kindFilter) all.push(issue);
    }
  }

  const byKind = new Map<string, number>();
  for (const i of all) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);

  console.log(`Checked TM for ${withTm} file(s); ${all.length} issue(s).\n`);
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }

  if (all.length > 0) {
    console.log(`\nSamples:`);
    for (const i of all.slice(0, 25)) {
      console.log(`  [${i.kind}] ${i.file} ${i.key}: ${i.detail}`);
    }
    if (all.length > 25) console.log(`  … and ${all.length - 25} more`);
    process.exitCode = 1;
  }
}

await main();
