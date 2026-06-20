# Taiwu localization toolkit

Translate **The Scroll of Taiwu** language files from English to Russian, using
the Chinese original as a meaning-of-record. Built for long-term maintenance:
zero-runtime-deps core, a git-tracked translation memory, and byte-exact writing
with backups.

- **Source:** `Language_EN` (English) · **Reference:** `Language_CN` (Chinese)
- **Target:** Russian, written back **in place** into `Language_EN`
- **Engine:** Yandex Cloud Translate (official SDK); offline `mock` for dry runs

## Requirements

- Node.js ≥ 22.15 (developed on 25)
- The game installed; the repo expects two junctions in its root pointing at the
  game's `StreamingAssets`:
  - `Language_EN` → `.../StreamingAssets/Language_EN`
  - `Language_CN` → `.../StreamingAssets/Language_CN`

  (Both are gitignored. Override locations with `TAIWU_LANG_DIR` /
  `TAIWU_LANG_CN_DIR` if your layout differs.)

## Install

```bash
npm install
npm test          # 760 tests
npm run typecheck
```

## Configuration (.env)

`.env` is loaded automatically by every command via Node's native
`--env-file-if-exists` (no dotenv). Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable                      | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `TAIWU_YANDEX_IAM_TOKEN`      | IAM token: `yc iam create-token` (valid ~12h)                  |
| `TAIWU_YANDEX_FOLDER_ID`      | Yandex Cloud folder id                                         |
| `TAIWU_LANG_DIR`              | Override EN source dir (default `./Language_EN`)               |
| `TAIWU_LANG_CN_DIR`           | Override CN reference dir                                      |
| `TAIWU_TM_DIR`                | Translation-memory dir (default `./tm`)                        |
| `TAIWU_BACKUP_DIR`            | Pristine backup dir (default `./backups/Language_EN.original`) |
| `TAIWU_GLOSSARY`              | Glossary file (default `./data/glossary.json`)                 |
| `TAIWU_YANDEX_RATE_RUB_PER_M` | Price estimate, RUB per 1M chars (default 419)                 |

## Workflow

```bash
npm run estimate                       # how many units / chars / ~cost
npm run translate -- --all --engine yandex   # translate into the TM (resumable)
npm run validate                       # QA the translations in the TM
npm run apply -- --all                 # write into Language_EN (backup + atomic)
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

| Command                                                                                | What it does                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------- |
| `npm run status [-- --files]`                                                          | Coverage: translated / stale / pending    |
| `npm run estimate`                                                                     | Pending units, characters, ~Yandex cost   |
| `npm run translate -- (<file>\|--all) [--engine mock\|yandex] [--limit N] [--dry-run]` | Translate into the TM                     |
| `npm run validate [-- <file>] [--semantic] [--kind <kind>]`                            | QA the TM, or EN↔CN markup divergence     |
| `npm run apply -- (<file>\|--all) [--dry-run]`                                         | Write the TM into `Language_EN`           |
| `npm run sync [-- --dry-run]`                                                          | Reconcile the TM after a game update      |
| `npm run roundtrip`                                                                    | Byte-exact round-trip check of all `.txt` |

## Safety & restore

In-place writing modifies the actual game files. Protections:

- A **pristine backup** of each file is taken once, before its first write, in
  `backups/Language_EN.original/` (never overwritten).
- Writes are **atomic** (temp file + rename) and pass a **structural guard**
  (keys, line/column counts, JSON paths unchanged) — corrupted output is refused.
- Markup (`{0}`, `<color=…>`, `<NL>`, `<Character …/>`) is masked during
  translation and validated on restore; a unit with broken markup is flagged,
  not written.

**Restore the originals** by copying the backup back over the game files, e.g.:

```bash
cp -r backups/Language_EN.original/* Language_EN/
```

(or restore via Steam: _Verify integrity of game files_).

## How it works

```
Language_EN ─┐                         ┌─► tm/*.json (translation memory, git-tracked)
Language_CN ─┴─ align (by key) ─ mask ─┤
                                       └─► Yandex/mock ─ restore+validate ─► TM ─ apply ─► Language_EN
```

- **Translation memory** (`tm/`): one JSON per source file, holding `en`, `cn`,
  `ru`, `status` (`pending`/`machine`/`reviewed`/`locked`) and a source hash for
  incremental re-runs. It is the durable asset — review and hand-edit it, set
  `status` to `reviewed`/`locked` to protect entries from re-translation.
- **Glossary** (`data/glossary.json`): EN→RU terms enforced verbatim. Bump
  `GLOSSARY_VERSION` in `src/config/glossary.ts` after edits to re-translate
  affected machine units.

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
