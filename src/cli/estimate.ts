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
import { listTranslatableTxtFiles } from "../scan.js";
import { computeCoverage, sumCoverage, type FileCoverage } from "../tm/coverage.js";
import { loadTm } from "../tm/store.js";

/** Approximate Yandex Translate price, rubles per 1M source characters. */
const DEFAULT_RATE_RUB_PER_M = 419;

function rate(): number {
  const env = process.env.TAIWU_YANDEX_RATE_RUB_PER_M;
  const parsed = env ? Number(env) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_RATE_RUB_PER_M;
}

async function main(): Promise<void> {
  const files = await listTranslatableTxtFiles();

  const coverages: FileCoverage[] = [];
  for (const file of files) {
    const aligned = await alignFile(file);
    const tm = await loadTm(file);
    coverages.push(computeCoverage(aligned, tm));
  }

  const total = sumCoverage(coverages);
  const toTranslate = total.pending + total.stale;
  const chars = total.pendingChars; // stale chars are recomputed at sync; pending is the floor
  const ratePerM = rate();
  const costRub = (chars / 1_000_000) * ratePerM;

  console.log(`Files:               ${files.length}`);
  console.log(`Units total:         ${total.total.toLocaleString("en-US")}`);
  console.log(`Units to translate:  ${toTranslate.toLocaleString("en-US")}`);
  console.log(`Source characters:   ${chars.toLocaleString("en-US")} (pending only)`);
  console.log(`\nRate:  ${ratePerM} RUB / 1M chars (approx; override TAIWU_YANDEX_RATE_RUB_PER_M)`);
  console.log(`Cost:  ~${costRub.toFixed(2)} RUB`);
}

await main();
