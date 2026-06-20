/**
 * Glossary candidate mining.
 *
 * Scans the English source corpus for terms worth adding to `data/glossary.json`
 * — the words and phrases whose translation should stay consistent everywhere:
 * proper nouns, item / sect / skill names, and recurring domain terminology
 * (e.g. "Sect Tournament", "True Qi", "Martial Arts", "Return of Taiwu").
 *
 * Heuristic: Title-Case is the signal. Game terminology in this corpus is
 * capitalised ("Hall Master", "Secret Tome"), so we harvest Title-Case runs:
 *
 *  - Multi-word runs ("Yin and Yang", "Scroll of Taiwu") are almost always
 *    proper nouns — kept on frequency alone.
 *  - Single capitalised words are noisier (every sentence starts with one), so
 *    they are kept only when they recur *mid-sentence*, where capitalisation is
 *    meaningful rather than grammatical, and are filtered against a stop-list.
 *
 * Markup ({0}, <color=…>, <NL>, …) is stripped via the same masker the engines
 * use, so tags never leak into candidates. Terms already in the glossary are
 * excluded. The result is ranked by corpus frequency for easy curation.
 */
import { mask } from "../engine/protect.js";

/** A representative source occurrence, shown so a curator can verify the term. */
export interface CandidateExample {
  file: string;
  en: string;
  cn: string | null;
}

/** One ranked glossary candidate. */
export interface Candidate {
  /** Canonical surface form (most frequent original casing). */
  term: string;
  /** Lowercased, whitespace-collapsed identity used for counting. */
  key: string;
  /** Total occurrences across the corpus. */
  count: number;
  /** Number of distinct source files it appears in. */
  files: number;
  /** Word count (1 = single token, ≥2 = phrase). */
  words: number;
  /** Occurrences not at the start of a sentence (the strong signal). */
  midSentence: number;
  example: CandidateExample;
}

/** A unit of source text to mine. */
export interface SourceText {
  file: string;
  en: string;
  cn: string | null;
}

export interface CandidateOptions {
  /** Minimum corpus frequency to keep a term. Default 3. */
  minCount?: number;
  /** Include single-word candidates (gated by the mid-sentence rule). Default true. */
  includeSingles?: boolean;
  /** Lowercased EN terms already in the glossary — excluded from results. */
  glossary?: ReadonlyMap<string, string>;
}

/**
 * A capitalised word: Title-Case ("Sword") or an acronym ("DLC", "HP").
 * Apostrophes are excluded so contractions ("It's", "I've") are not Title words
 * and instead break runs — the corpus's proper nouns carry no apostrophes.
 */
const TITLE_WORD = /^(?:\p{Lu}\p{Ll}*|\p{Lu}{2,})$/u;
/** Lowercase connectors allowed *inside* a multi-word run (never at its edges). */
const CONNECTORS = new Set([
  "of",
  "the",
  "and",
  "in",
  "on",
  "for",
  "to",
  "a",
  "an",
  "with",
  "by",
  "de",
  "von",
  "der",
  "or",
  "at",
  "from",
]);
/** Common capitalised function words never useful as single-word terms. */
const STOPWORDS = new Set([
  "the",
  "you",
  "your",
  "yours",
  "this",
  "that",
  "these",
  "those",
  "a",
  "an",
  "and",
  "but",
  "or",
  "if",
  "when",
  "while",
  "as",
  "so",
  "it",
  "its",
  "he",
  "she",
  "they",
  "them",
  "we",
  "us",
  "i",
  "in",
  "on",
  "at",
  "to",
  "of",
  "for",
  "with",
  "by",
  "from",
  "up",
  "out",
  "no",
  "not",
  "yes",
  "now",
  "then",
  "here",
  "there",
  "what",
  "who",
  "whom",
  "why",
  "how",
  "all",
  "each",
  "every",
  "some",
  "any",
  "once",
  "after",
  "before",
  "during",
  "their",
  "his",
  "her",
  "my",
  "our",
  "me",
  "do",
  "does",
  "did",
  "can",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "must",
  "have",
  "has",
  "had",
  "be",
  "is",
  "are",
  "was",
  "were",
  "been",
  "being",
  "into",
  "over",
  "under",
  "than",
  "too",
  "very",
  "just",
  "only",
  "also",
  "more",
  "most",
  "such",
  "both",
  "either",
  "neither",
  "about",
  "above",
  "below",
  "between",
  "through",
  "because",
  "however",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
]);

/** A word and whether it begins its sentence (capitalisation there is forced). */
interface Token {
  word: string;
  sentenceStart: boolean;
}

/** Split text into sentences, then into alphabetic tokens flagged by position. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Sentence breaks: terminal punctuation, or a hard newline / list separator.
  for (const sentence of text.split(/(?:[.!?:;…]+|\n|\r)\s*/u)) {
    const words = sentence.match(/[\p{L}'’]+/gu);
    if (!words) continue;
    for (let i = 0; i < words.length; i++) {
      tokens.push({ word: words[i] as string, sentenceStart: i === 0 });
    }
  }
  return tokens;
}

interface RawTerm {
  term: string;
  words: number;
  sentenceStart: boolean;
}

/** Yield maximal Title-Case runs (start/end on a Title word, connectors inside). */
function* runs(tokens: Token[]): Generator<RawTerm> {
  let i = 0;
  while (i < tokens.length) {
    const start = tokens[i] as Token;
    if (!TITLE_WORD.test(start.word)) {
      i++;
      continue;
    }
    const run = [start.word];
    let end = i; // index of the last Title word actually included
    let k = i + 1;
    while (k < tokens.length) {
      const w = (tokens[k] as Token).word;
      if (TITLE_WORD.test(w)) {
        run.push(w);
        end = k;
        k++;
      } else if (
        CONNECTORS.has(w.toLowerCase()) &&
        k + 1 < tokens.length &&
        TITLE_WORD.test((tokens[k + 1] as Token).word)
      ) {
        run.push(w);
        k++;
      } else {
        break;
      }
    }
    // Trim to the last Title word (a trailing connector cannot end a run).
    const span = run.slice(0, end - i + 1);
    const emit = (words: string[], sentenceStart: boolean): RawTerm => ({
      term: words.join(" "),
      words: words.filter((w) => !CONNECTORS.has(w.toLowerCase())).length,
      sentenceStart,
    });
    yield emit(span, start.sentenceStart);

    // When the run's first word is capitalised only because it opens a sentence,
    // also emit the run without it (re-trimming any now-leading connector). The
    // first word may be grammatical caps ("Enter the Sect Tournament"); the
    // sub-run ("Sect Tournament") recurs mid-sentence and wins on frequency.
    if (start.sentenceStart && span.length > 1) {
      let sub = span.slice(1);
      while (sub.length > 0 && CONNECTORS.has((sub[0] as string).toLowerCase())) sub = sub.slice(1);
      if (sub.length > 0) yield emit(sub, false);
    }
    i = end + 1;
  }
}

interface Aggregate {
  surfaces: Map<string, number>;
  count: number;
  files: Set<string>;
  words: number;
  midSentence: number;
  example: CandidateExample;
}

/** Mine ranked glossary candidates from a stream of source texts. */
export function collectCandidates(
  texts: Iterable<SourceText>,
  options: CandidateOptions = {},
): Candidate[] {
  const minCount = options.minCount ?? 3;
  const includeSingles = options.includeSingles ?? true;
  const glossary = options.glossary ?? new Map<string, string>();
  const agg = new Map<string, Aggregate>();

  for (const { file, en, cn } of texts) {
    // Strip markup with the engines' masker, then drop the sentinels it leaves.
    const clean = mask(en).masked.replace(/<m\d+><\/m\d+>/g, " ");
    for (const raw of runs(tokenize(clean))) {
      const key = raw.term.toLowerCase().replace(/\s+/g, " ");
      let a = agg.get(key);
      if (!a) {
        a = {
          surfaces: new Map(),
          count: 0,
          files: new Set(),
          words: raw.words,
          midSentence: 0,
          example: { file, en, cn },
        };
        agg.set(key, a);
      }
      a.count++;
      a.files.add(file);
      a.surfaces.set(raw.term, (a.surfaces.get(raw.term) ?? 0) + 1);
      if (!raw.sentenceStart) a.midSentence++;
    }
  }

  const out: Candidate[] = [];
  for (const [key, a] of agg) {
    if (glossary.has(key)) continue;
    if (a.count < minCount) continue;
    if (a.words < 2) {
      // Single-word term: needs the strong mid-sentence signal and must not be
      // a bare function word or a single letter.
      if (!includeSingles) continue;
      if (key.length < 2 || STOPWORDS.has(key)) continue;
      // Contractions ("It's", "I've") are never glossary terms.
      if (/['’]/.test(key)) continue;
      if (a.midSentence < minCount) continue;
    }
    // Canonical form: the most frequent original casing (ties: first seen).
    const term = [...a.surfaces.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? key;
    out.push({
      term,
      key,
      count: a.count,
      files: a.files.size,
      words: a.words,
      midSentence: a.midSentence,
      example: a.example,
    });
  }

  // Rank: most frequent first, then widest spread, then phrases over singles.
  out.sort(
    (x, y) =>
      y.count - x.count || y.files - x.files || y.words - x.words || x.key.localeCompare(y.key),
  );
  return out;
}
