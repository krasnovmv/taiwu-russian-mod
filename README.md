# Taiwu localization toolkit

Translate **The Scroll of Taiwu** language files from English to Russian, using
the Chinese original as a meaning-of-record. Built for long-term maintenance:
a lean-dependency core, a git-tracked translation memory, and byte-exact,
reversible output.

- **Source:** `Language_EN` (English) · **Reference:** `Language_CN` (Chinese)
- **Target:** Russian, written to a separate **`Language_RU`** folder (the source
  is never modified)
- **Engines:** Yandex Cloud Translate (official SDK) · LM Studio (local LLM) ·
  offline `mock` for dry runs

## Requirements

- Node.js ≥ 22.15 (developed on 25)
- The game installed; the repo uses junctions in its root pointing at the game's
  `StreamingAssets`:
  - `Language_EN` → `.../StreamingAssets/Language_EN` (source)
  - `Language_CN` → `.../StreamingAssets/Language_CN` (reference)
  - `Language_RU` → `.../StreamingAssets/Language_RU` (output; `apply` writes here)
  - `Event_Languages` → `.../Event/EventLanguages` (root quest/event text — lives
    OUTSIDE `StreamingAssets`; EN/CN/output all share this one folder, keyed by
    the `_Language_XX` filename suffix, and the KO slot is the RU output). Gated
    behind `TAIWU_EVENTS` (off by default; large corpus).
  - `Event_DLC/<DLC>` → `.../<DLC>` (one junction per expansion, into the game's
    `…_Data`). Each DLC keeps versioned quest packs under
    `<version>/Events/EventLanguages`; discovery uses the newest version with EN
    text. Always on (small corpus).

  (All gitignored. Override with `TAIWU_LANG_DIR` / `TAIWU_LANG_CN_DIR` /
  `TAIWU_LANG_RU_DIR` if your layout differs — e.g. to keep RU out of the game.)

  Create the quest junctions with `mklink /J` (or PowerShell
  `New-Item -ItemType Junction`), e.g.:
  `mklink /J Event_Languages "…\The Scroll Of Taiwu\Event\EventLanguages"` and,
  per DLC, `mklink /J Event_DLC\FiveLoong "…\The Scroll of Taiwu_Data\FiveLoong"`.

## Install

```bash
npm install
npm test          # 775 tests
npm run typecheck
```

## Configuration (.env)

`.env` is loaded automatically by every command via Node's native
`--env-file-if-exists` (no dotenv). Copy the template and fill it in:

```bash
cp .env.example .env
```

Yandex credentials are not configured here — they always come from the `yc` CLI
(run `yc init` once). All variables are optional:

| Variable                     | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `TAIWU_LANG_RU_DIR`          | RU output dir for `apply` (default `./Language_RU` into game) |
| `TAIWU_LMSTUDIO_BASE_URL`    | LM Studio server (default `http://localhost:1234/v1`)         |
| `TAIWU_LMSTUDIO_MODEL`       | Model id (default: first non-embedding model loaded)          |
| `TAIWU_LMSTUDIO_CONCURRENCY` | Parallel requests to LM Studio (default 4)                    |

Source/CN/TM/glossary paths are fixed (`./Language_EN`, `./Language_CN`, `./tm`,
`./data/glossary.json`).

## Engines

| Engine     | Use it for                | Setup                                      |
| ---------- | ------------------------- | ------------------------------------------ |
| `mock`     | dry runs / tests (free)   | none                                       |
| `yandex`   | fast machine translation  | `yc init` once (credentials via `yc`)      |
| `lmstudio` | local LLM (free, private) | LM Studio running with a chat model loaded |

```bash
# Local LLM via LM Studio (start the server and load a model first):
npm run translate -- --all --engine lmstudio
```

Markup (`{0}`, `<color=…>`, `<NL>`, …) is masked to `⟦n⟧` tokens before every
engine call and validated on restore, so the same safety applies to all engines.

## Workflow

Translate everything with one fast engine, then let a local LLM judge and repair
the result:

```bash
npm run estimate                       # how many units / chars / ~cost
npm run translate-all                  # Yandex for everything ≤ --max-len (resumable)
npm run judge-all                      # LLM judge: review + fix the machine output
npm run validate                       # QA the translations in the TM
npm run apply -- --all                 # build Language_RU (source untouched)
```

`translate-all` is `translate -- --all --engine yandex --max-len 10000`: every
unit up to `--max-len` characters goes to Yandex, and anything longer is **skipped
entirely** (it keeps its English on apply). Override the cap per run:
`npm run translate-all -- --max-len 500`.

Quality is not the translator's job any more — it's the judge's. `judge-all`
walks the machine translations and shows each one to a local LLM (LM Studio) with
the file it lives in, the English source, the **Chinese original** (the meaning of
record) and the applicable glossary terms; a translation ruled wrong is rewritten
in place in the TM as `status: "judged"`. It costs nothing but local GPU time, and
is resumable — see [LLM judge](#llm-judge).

Length-routing across two engines still exists (`translate -- --all --route
[--threshold N]`: short → Yandex, long → LM Studio) but is no longer the default
path. Or pick one engine with `--engine`, optionally windowed by
`--min-len`/`--max-len`.

Smaller, safer steps while getting started:

```bash
npm run translate -- Month_language.txt --engine yandex --limit 50
npm run apply -- Month_language.txt --dry-run    # preview, writes nothing
npm run apply -- Month_language.txt              # write one file
```

`translate` and `apply` are **incremental and resumable** — re-running skips work
already done. Nothing is ever written to the game until you run `apply`.

## After a game update

```bash
npm run sync -- --dry-run    # report new / removed / drifted keys (no tokens spent)
npm run sync                 # reconcile the TM
npm run translate -- --all --engine yandex   # fill new + drifted units
npm run apply -- --all
```

`sync` never overwrites `reviewed`/`locked` units; it only reports when their
source changed so you can re-check them.

## LLM judge

```bash
npm run judge-all                          # every file, every unjudged unit
npm run judge -- Accessory_language.txt    # one file
npm run judge -- --all --dry-run           # report the fixes, write nothing
npm run judge -- --all --min-len 40        # only the long prose
npm run judge -- --all --limit 20          # sample 20 units per file
npm run judge -- --all --force             # re-judge units that already have a verdict
```

The judge reviews an **existing** translation; it never translates from scratch
(that's `translate-all`). It leaves alone: pending units, `reviewed`/`locked`
units (human curation always wins), language-neutral units (ids/codes), and units
whose source has drifted since they were translated — those need re-translating
first.

### Why it doesn't rewrite everything

The model is not asked "is this good?" — an LLM answering that will always find
something to improve, and you end up with half the corpus churned into synonyms.
Instead it does **MQM error annotation** (the standard used to mark up MT quality,
in the shape [GEMBA-MQM](https://arxiv.org/abs/2310.13988) popularised for LLM
judges): it lists the concrete errors it found, each with a category
(`accuracy/mistranslation`, `terminology`, `fluency/agreement`, …) and a severity:

| Severity   | Meaning                                                          | Rewrite? |
| ---------- | ---------------------------------------------------------------- | -------- |
| `critical` | misleads the player about mechanics, or the text is unusable     | yes      |
| `major`    | meaning changed, or comprehension disrupted                      | yes      |
| `minor`    | an error, but it neither disrupts flow nor hinders comprehension | **no**   |

**The decision is made in code, not by the model** (`shouldFix` in
`src/judge/prompt.ts`): a rewrite happens only when the annotation contains a
major or critical error. A clumsy-but-clear phrasing, a synonym the model likes
less, a word order it wouldn't have chosen — all minor, all left alone. The prompt
also names, explicitly, what is _not_ an error, because that's where an eager
judge does its damage.

Then every rewrite the model does propose is re-checked in code against
`checkTranslation` — the **same function `npm run validate` runs**: markup parity,
escape and real-newline counts, non-empty, no leftover English, sane length ratio.
A rewrite that fails any of them is thrown away and the unit is left unmarked, so
a later run retries it. The judge can never write something QA would then flag.

### Changing the model

```bash
TAIWU_LMSTUDIO_MODEL=<better-model>   # or, per run: npm run judge -- --all --model <id>
TAIWU_JUDGE_VERSION=4                 # invalidate every past verdict
npm run judge-all
```

A new model on its own re-judges **nothing**: the model is deliberately not part
of `judgeHash`, or every LM Studio update would silently re-judge the corpus. Bump
`TAIWU_JUDGE_VERSION` (or use `--force` on one file to sample first).

A unit an earlier pass rewrote holds that pass's wording, not the engine's — so on
a re-judge the model is _also_ shown the raw engine output, recovered from
`cache/<engine>.jsonl`, as a **MACHINE** block. It is told that the Russian under
review is an earlier judge's rewrite of it, and that it may put MACHINE's wording
back if the rewrite drifted. Without this a second pass would grade the first
pass's output as if the engine had written it, and rewrites would pile up on each
other. Nothing is lost by design: the engine's original always stays in the cache.

Each verdict is remembered on the unit (`judgeHash`), so re-running is cheap and
resumable. A unit is judged again only when something the verdict rested on moved:
the EN source, the glossary terms in it, or the CN reference. `JUDGE_VERSION` in
`src/config/judge.ts` (or `TAIWU_JUDGE_VERSION`) is the global re-judge lever —
bump it after editing the prompt, or nothing re-judges.

A judged fix survives `rebuild-tm`: a cache-only rebuild will not overwrite it
with the raw engine output it was derived from. A real source or engine change
still re-translates the unit from scratch, dropping the fix.

The prompt lives in `src/judge/prompt.ts`; replace it wholesale with
`TAIWU_JUDGE_PROMPT_FILE=path/to/prompt.txt` (and bump `JUDGE_VERSION`).

| Env                        | What                                                 |
| -------------------------- | ---------------------------------------------------- |
| `TAIWU_JUDGE_CONCURRENCY`  | Parallel judge requests (default 4)                  |
| `TAIWU_JUDGE_CHECKPOINT`   | Units judged per TM flush (default 25)               |
| `TAIWU_JUDGE_EXPLANATIONS` | `0` drops the per-error explanation (smaller output) |
| `TAIWU_JUDGE_VERSION`      | Bump to invalidate every past verdict                |
| `TAIWU_JUDGE_PROMPT_FILE`  | Replace the built-in judge system prompt             |

## Commands

| Command                                                                                                                         | What it does                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `npm run status [-- --files]`                                                                                                   | Coverage: translated / stale / pending             |
| `npm run estimate`                                                                                                              | Pending units, characters, ~Yandex cost            |
| `npm run translate -- (<file>\|--all) [--engine …\|--route] [--limit N] [--min-len N] [--max-len N] [--dry-run]`                | Translate into the TM (`--route` = length-routed)  |
| `npm run translate-all [-- --max-len N]`                                                                                        | Translate everything with Yandex up to `--max-len` |
| `npm run judge -- (<file>\|--all) [--limit N] [--min-len N] [--max-len N] [--concurrency N] [--model ID] [--force] [--dry-run]` | LLM judge: review + fix the TM's machine output    |
| `npm run validate [-- <file>] [--semantic] [--kind <kind>]`                                                                     | QA the TM, or EN↔CN markup divergence              |
| `npm run apply -- (<file>\|--all) [--dry-run]`                                                                                  | Build `Language_RU` from the TM                    |
| `npm run sync [-- --dry-run]`                                                                                                   | Reconcile the TM after a game update               |
| `npm run roundtrip`                                                                                                             | Byte-exact round-trip check of all `.txt`          |
| `npm run glossary:candidates [-- --min N --top N --phrases --json f --skeleton f]`                                              | Mine source for glossary term candidates           |

## Safety

`apply` writes to a separate `Language_RU` folder and never touches the original
`Language_EN`, so it is fully reversible — **delete `Language_RU` to undo**.
Further protections:

- Writes are **atomic** (temp file + rename) and pass a **structural guard**
  (keys, line/column counts, JSON paths unchanged) — corrupted output is refused.
- Markup (`{0}`, `<color=…>`, `<NL>`, `<Character …/>`) is masked during
  translation and validated on restore; a unit with broken markup is flagged,
  not written.

With the `Language_RU` junction pointing into the game's `StreamingAssets`,
`apply` deploys straight into the game. To keep output local instead, set
`TAIWU_LANG_RU_DIR` to a project path.

## How it works

```
Language_EN ─┐                         ┌─► tm/*.json (translation memory, git-tracked)
Language_CN ─┴─ align (by key) ─ mask ─┤
                                       └─► engine ─ restore+validate ─► TM ─ apply ─► Language_RU
```

- **Translation memory** (`tm/`): one JSON per source file, holding `en`, `cn`,
  `ru`, `status` (`pending`/`machine`/`reviewed`/`locked`) and a source hash for
  incremental re-runs. It is the durable asset — review and hand-edit it, set
  `status` to `reviewed`/`locked` to protect entries from re-translation.
- **Glossary** (`data/glossary.json`): EN→RU terms handed to the engine to
  enforce — Yandex via its native `glossaryConfig` (`exact: false`, so it
  **declines** each term to fit Russian grammar), LM Studio via the prompt. Only
  terms that occur in a unit are sent, and both the response cache **and** the TM
  `srcHash` fold those terms into their key, so editing a term re-translates only
  the units containing it — no version bump or global churn. `GLOSSARY_VERSION` in
  `src/config/glossary.ts` is now only the manual "re-translate everything" lever
  (engine/style overhauls). Run `npm run glossary:candidates` to mine the source
  for recurring proper nouns and domain terms worth adding (ranked by frequency,
  with a CN example per term); `--skeleton f` writes a fill-in stub to curate.

### Formats

| Format                    | Files                                     | Adapter                               |
| ------------------------- | ----------------------------------------- | ------------------------------------- |
| Paired `.txt` (key/value) | top-level `*.txt`                         | `paired-txt`                          |
| `.tsv` tables             | `EncyclopediaAssets/*.tsv`                | `tsv` (cell text, tab grid preserved) |
| Nested `.json` tips       | `CommonTip/**/*.json`                     | `json-tip` (only `title`/`content`)   |
| Multiline `.txt`          | `CricketPolymorphEvent`, `ImplementedDlc` | `anchored-txt` (CN as key oracle)     |
| Quest/event text          | `Event_Languages/*` and `Event_DLC/**`    | `event-languages` (GUID-keyed blocks) |

All adapters guarantee a byte-exact identity round-trip (verified over every real
file in the test suite). The `event-languages` adapter parses GUID-keyed event
blocks (`EventContent` + `Option_N` are translated; `EventGuid`/`EventName` are
structural anchors), pairs the CN reference by GUID, and writes RU into the KO
filename slot in the same folder.

## Development

```bash
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # eslint (type-checked)
npm run format         # prettier
npm test               # node:test
```

See `PLAN.md` for the phased build log.
