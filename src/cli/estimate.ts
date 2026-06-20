/**
 * Estimate the remaining translation workload and approximate Yandex cost.
 *
 *   npm run estimate
 *
 * Yandex Translate bills per character of *source* text. The rate is approximate
 * and changes over time — override it with `TAIWU_YANDEX_RATE_RUB_PER_M`
 * (rubles per 1,000,000 characters).
 */
import { alignFile } from "../align/bilingual.js";
import { listSourceFiles } from "../scan.js";
import { computeCoverage, sumCoverage, type FileCoverage } from "../tm/coverage.js";
import { loadTm } from "../tm/store.js";
import { Progress } from "./progress.js";

/** Approximate Yandex Translate price, rubles per 1M source characters. */
const DEFAULT_RATE_RUB_PER_M = 419;

function rate(): number {
  const env = process.env.TAIWU_YANDEX_RATE_RUB_PER_M;
  const parsed = env ? Number(env) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_RATE_RUB_PER_M;
}

async function main(): Promise<void> {
  const files = await listSourceFiles();

  const bar = new Progress(files.length, "estimate");
  const coverages: FileCoverage[] = [];
  for (const file of files) {
    const aligned = await alignFile(file);
    const tm = await loadTm(file);
    coverages.push(computeCoverage(aligned, tm));
    bar.increment(file);
  }
  bar.finish();

  const total = sumCoverage(coverages);
  const ratePerM = rate();
  // Cost is computed from pending characters only; stale units re-use their
  // original source whose chars are not tracked separately, so the cost is a
  // lower bound when stale units exist.
  const costRub = (total.pendingChars / 1_000_000) * ratePerM;
  const fmt = (n: number): string => n.toLocaleString("en-US");

  console.log(`Files:               ${fmt(files.length)}`);
  console.log(`Units total:         ${fmt(total.total)}`);
  console.log(`Units pending:       ${fmt(total.pending)}`);
  console.log(`Units stale:         ${fmt(total.stale)} (source drifted; re-translate via sync)`);
  console.log(`Pending characters:  ${fmt(total.pendingChars)}`);
  console.log(`\nRate:  ${ratePerM} RUB / 1M chars (approx; override TAIWU_YANDEX_RATE_RUB_PER_M)`);
  console.log(
    `Cost:  ~${costRub.toFixed(2)} RUB (pending only${total.stale > 0 ? "; lower bound" : ""})`,
  );
}

await main();
