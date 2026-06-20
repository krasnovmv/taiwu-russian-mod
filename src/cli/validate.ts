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
  const argv = process.argv.slice(2);
  let semantic = false;
  let kindFilter: IssueKind | undefined;
  let fileArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--semantic") semantic = true;
    else if (arg === "--kind") kindFilter = argv[++i] as IssueKind | undefined;
    else if (arg && !arg.startsWith("--")) fileArg = arg;
  }

  const files = fileArg ? [fileArg] : await listSourceFiles();
  const all = (await collect(files, semantic)).filter((i) => !kindFilter || i.kind === kindFilter);

  // `untranslated` (RU == EN) is expected while translation is incomplete — it is
  // informational, not an error: it is reported but never fails the run.
  const INFO_KINDS = new Set<IssueKind>(["untranslated"]);
  const errors = all.filter((i) => !INFO_KINDS.has(i.kind));
  const info = all.filter((i) => INFO_KINDS.has(i.kind));

  const byKind = new Map<string, number>();
  for (const i of all) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);

  const mode = semantic ? "EN↔CN semantic" : "TM";
  console.log(
    `Checked ${files.length} file(s) [${mode}]; ${errors.length} error(s)` +
      (info.length > 0 ? `, ${info.length} informational` : "") +
      `.\n`,
  );
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}${INFO_KINDS.has(kind as IssueKind) ? " (info)" : ""}`);
  }

  if (errors.length > 0) {
    console.log(`\nSamples:`);
    for (const i of errors.slice(0, 25))
      console.log(`  [${i.kind}] ${i.file} ${i.key}: ${i.detail}`);
    if (errors.length > 25) console.log(`  … and ${errors.length - 25} more`);
    process.exitCode = 1;
  }
}

await main();
