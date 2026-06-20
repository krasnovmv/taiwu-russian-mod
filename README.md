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

  (All gitignored. Override with `TAIWU_LANG_DIR` / `TAIWU_LANG_CN_DIR` /
  `TAIWU_LANG_RU_DIR` if your layout differs — e.g. to keep RU out of the game.)

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

```bash
npm run estimate                       # how many units / chars / ~cost
npm run translate -- --all --engine yandex   # translate into the TM (resumable)
npm run validate                       # QA the translations in the TM
npm run apply -- --all                 # build Language_RU (source untouched)
```

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

## Commands

| Command                                                                                          | What it does                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `npm run status [-- --files]`                                                                    | Coverage: translated / stale / pending    |
| `npm run estimate`                                                                               | Pending units, characters, ~Yandex cost   |
| `npm run translate -- (<file>\|--all) [--engine mock\|yandex\|lmstudio] [--limit N] [--dry-run]` | Translate into the TM                     |
| `npm run validate [-- <file>] [--semantic] [--kind <kind>]`                                      | QA the TM, or EN↔CN markup divergence     |
| `npm run apply -- (<file>\|--all) [--dry-run]`                                                   | Build `Language_RU` from the TM           |
| `npm run sync [-- --dry-run]`                                                                    | Reconcile the TM after a game update      |
| `npm run roundtrip`                                                                              | Byte-exact round-trip check of all `.txt` |
| `npm run glossary:candidates [-- --min N --top N --phrases --json f --skeleton f]`               | Mine source for glossary term candidates  |

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
  terms that occur in a unit are sent, and the response cache folds those terms
  into its key, so editing a term re-translates only the units containing it.
  Bump `GLOSSARY_VERSION` in `src/config/glossary.ts` after edits to re-translate
  affected machine units. Run `npm run glossary:candidates` to mine the source
  for recurring proper nouns and domain terms worth adding (ranked by frequency,
  with a CN example per term); `--skeleton f` writes a fill-in stub to curate.

### Formats

| Format                    | Files                                     | Adapter                               |
| ------------------------- | ----------------------------------------- | ------------------------------------- |
| Paired `.txt` (key/value) | top-level `*.txt`                         | `paired-txt`                          |
| `.tsv` tables             | `EncyclopediaAssets/*.tsv`                | `tsv` (cell text, tab grid preserved) |
| Nested `.json` tips       | `CommonTip/**/*.json`                     | `json-tip` (only `title`/`content`)   |
| Multiline `.txt`          | `CricketPolymorphEvent`, `ImplementedDlc` | `anchored-txt` (CN as key oracle)     |

All adapters guarantee a byte-exact identity round-trip (verified over every real
file in the test suite).

## Development

```bash
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # eslint (type-checked)
npm run format         # prettier
npm test               # node:test
```

See `PLAN.md` for the phased build log.
