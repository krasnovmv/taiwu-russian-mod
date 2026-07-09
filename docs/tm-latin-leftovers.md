# Проблема: английские остатки в RU-переводах (TM)

Статус: **не исправлено** (задокументировано 2026-07-09, чинить позже)

## Симптом

Часть RU-юнитов в TM содержит непереведённую латиницу — от целых строк,
скопированных из EN как есть, до английских слов посреди русского текста:

> «Познание **Rainbow Ultima** — Персона», «Сценарий **Kai**»,
> «Идентификатор экземпляра **Encounter**», «**DMG** от Металла»

## Масштаб (замер по `tm/**/*.json`, 2026-07-09)

Всего RU-юнитов: **296 553**.

| Категория | Кол-во |
|---|---|
| Любая латиница вне легальной разметки | 5 277 |
| Латинские слова из 2+ букв | 4 373 |
| — из них `ru === en` (сквозная копия EN) | 1 763 |
| — из них частичный перевод (латиница внутри русского текста) | **2 610** |

«Легальная разметка» исключена из подсчёта: `<...>`-теги, `{...}`-плейсхолдеры,
литеральные `\n`/`\r`/`\t`, `°c`.

### Сквозные копии (`ru === en`) — в основном намеренные/безвредные

- `Name_language.txt.json` (~1024): пиньинь-фамилии (`Bai`, `Cai`, `Ge`, `Yi`…).
  Вероятно, надо транслитерировать в кириллицу (Бай, Цай, Гэ, И) — отдельное
  решение, машинному переводу такое доверять нельзя.
- `AdventureCore_language.txt.json` (~600 из 822): dev-идентификаторы параметров
  (`IsHostile`, `HostingTime`, `MaPaEnNu`) — переводить не нужно.
- `DevelopmentTeam_language.txt.json` (72): имена разработчиков.

### Частичные недопереводы (2 610) — настоящая проблема

Топ файлов:

| Файл | Кол-во |
|---|---|
| EventFunction_language.txt.json | 316 |
| SpecialEffect_language.txt.json | 291 |
| ui_language.txt.json | 254 |
| AdventureCore_language.txt.json | 218 |
| EncyclopediaAssets/EncyclopediaReference.tsv.json | 170 |
| EncyclopediaAssets/EncyclopediaContent.tsv.json | 118 |
| AiCondition_language.txt.json | 90 |
| Armor_language.txt.json | 64 |

Частые токены: `DMG` (231), `Encounter/encounter` (251), `NPC` (133),
`Description` (103), `XP` (78), названия техник и предметов (`Heartbane`,
`Envenom`, `Rainbow`, `Ultima`, `Weiqi`, `Trinity`, `Nimble`, `Abyss`).

Отдельно подозрительные:

- **`true` (91)** — похоже на утёкшее булево из разметки (например, атрибут
  тега, попавший в текст), а не просто недоперевод. Проверить на предмет
  сломанного маркапа.
- **`nIt` (27)** — обломок литерального `\n`, склеенного с английским
  продолжением (`\nIt ...`): и перенос сломан, и текст не переведён.

## Как воспроизвести

```bash
node -e '
const fs=require("fs"),path=require("path");
const walk=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  e.isDirectory()?walk(p,o):e.name.endsWith(".json")&&o.push(p);}return o};
const clean=s=>s.replace(/<[^<>]*>/g," ").replace(/\{[^{}]*\}/g," ")
  .replace(/\\u[0-9a-fA-F]{4}/g," ").replace(/\\[nrt]/g," ").replace(/°[cCfF]/g," ");
let total=0,any=0,words=0,same=0;
for(const f of walk("tm")){
  let d;try{d=JSON.parse(fs.readFileSync(f,"utf8"))}catch{continue}
  if(!d.units)continue;
  for(const u of Object.values(d.units)){
    if(typeof u?.ru!=="string"||!u.ru)continue;
    total++;const c=clean(u.ru);
    if(/[A-Za-z]/.test(c))any++;
    if(/[A-Za-z][A-Za-z\x27’-]*[A-Za-z]/.test(c)){words++;if(u.ru===u.en)same++;}
  }
}
console.log({total,anyLatin:any,latinWords:words,ruEqEn:same,partial:words-same});
'
```

Тот же скрипт с выгрузкой ворклиста (`{file, key, en, ru}` построчно) — добавить
сбор строк в массив и `writeFileSync` в jsonl.

## Направления фикса

1. **Частичные недопереводы (2 610).** Править надо в
   `cache/yandex.jsonl` (ручные фиксы живут в кэше, TM пересобирается из него —
   см. память `taiwu-hand-fixes-live-in-cache`), а не в TM напрямую.
   Кандидаты на глоссарий: `DMG`, `XP`, `Encounter`, `NPC`, названия техник —
   прогнать `npm run glossary:candidates`, добавить термины и перегнать
   затронутые юниты.
2. **`true` и `nIt`** — сначала диагностика: это может быть сломанная разметка
   источника (тогда чинить в `data/source-fixes.ts` на этапе экстракции), а не
   перевод.
3. **Пиньинь-имена (Name_language)** — отдельная задача о транслитерации
   в кириллицу по таблице Палладия; машинному переводу не отдавать.
4. **Dev/GM-строки (AdventureCore Parameters, DevelopmentTeam)** — пометить как
   «не переводить», чтобы не шумели в будущих замерах.
