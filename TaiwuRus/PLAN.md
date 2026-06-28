# TaiwuRus — план загрузчика русской локализации

Мод-загрузчик для **The Scroll of Taiwu** (太吾绘卷), цель — полностью русифицировать игру,
не трогая её оригинальные файлы. Перевод (TM, ~470k строк) делает отдельный TS-тулчейн в корне
репозитория; **этот** проект — рантайм-загрузчик, который заставляет движок показывать русский.

## 0. Ключевой принцип (почему загрузчик вообще нужен)

В движке два селектора языка:

- **`LocalStringManager.CurLanguageKey`** — строка (`"RU"`).
- **`LocalStringManager.CurLanguageType`** — enum `{CN, EN, KO, CNH, JP}`; если ключ не парсится
  в enum (а `RU`/`TH` там нет), геттер возвращает **`EN`**.

Отсюда всё:
- Подсистемы на **строковом ключе** видят `Language_RU` сами → переводятся **без кода**.
- Подсистемы на **enum** для «RU» молча сваливаются в **EN** → нужен Harmony-патч,
  подставляющий `RU` вместо EN-фолбэка.

**Вся работа загрузчика = перехватить enum-зависимые пути и подставить `RU`.**

## 1. Архитектура

Приоритет — **громкий отказ на сборке**: проблемы должны быть явными на этапе компиляции,
а не тихими no-op'ами в рантайме. Поэтому — типизированный доступ, а не рефлексия.

- **Два проекта** (роль = проект), оба выводят в общий `dist/Plugins/`:
  - `TaiwuRus.Frontend` → `net48`, `TaiwuRusF.dll` (Unity/Mono; ссылки из `Managed\`);
  - `TaiwuRus.Backend` → `net8.0`, `TaiwuRusB.dll` (.NET 8; ссылки из `Backend\`);
  - `TaiwuRus.Shared` → `netstandard2.0`, линкуется по исходнику в оба.
- **Типизированные патчи**: `[HarmonyPatch(typeof(T), nameof(T.Method))]`, прямой доступ к
  членам. Переименовали тип/метод/поле в игре → **билд падает**, видно что чинить.
- **Публицирование** game-сборок через `Krafs.Publicizer` (MSBuild, файлы игры не трогает):
  frontend публицирует `Assembly-CSharp`, backend — `GameData`. Так `internal`/`private`
  члены (`_languageFilePattern`, `ToolTipCommon.LoadConfig`, поле `imagePattern`…) тоже
  проверяются компилятором.
- **Почему не один dll**: при типизированном `PatchAll()` Harmony во фронтенд-процессе
  попытается резолвить backend-типы → `TypeLoadException`. Два проекта это исключают — каждый
  видит только «свои» типы.
- База — `TaiwuRemakePlugin` (с 1.0.24; не `...HarmonyPlugin`), Harmony создаём вручную,
  `PatchAll(assembly)` + `UnpatchSelf()` в `Dispose`.
- **Плата** (осознанно): мод **не соберётся** на изменённой версии игры → апдейт игры может
  требовать правок кода до выпуска (это и есть цель — явные проблемы). Минус один dll на обе
  роли и зависимость от публицирования.

## 2. Что должен делать загрузчик — по подсистемам

Легенда статуса: ✅ работает без кода · 🔧 патч обязателен · 🔮 будущее.

| # | Подсистема | Поведение движка | Что делает загрузчик | Файлы | Статус |
|---|---|---|---|---|---|
| 1 | Регистрация языка | `CollectLanguages` сканит `StreamingAssets/Language_*`, читает `ui_language.txt` каждой | ничего (или рефлексия-вызов `CollectLanguages` после деплоя) | `Language_RU/ui_language.txt` | ✅ |
| 2 | Статический текст | `Init("RU")` грузит `Language_RU/*.txt` по строковому ключу | ничего | `Language_RU/*.txt` | ✅ |
| 3 | Сортировка/кодировка | `FrameWork.Utils_Sorting.LanguageEncodingDict` без RU | `dict["RU"] = Encoding.Unicode` | — | 🔧 frontend |
| 4 | События/диалоги/квесты | `TaiwuEventDomain.ReloadSinglePackageLanguage` → `InitLanguage(_Language_{CurLanguageType}.txt)` = **EN** | Prefix: грузить `_Language_RU.txt` (фолбэк EN) | `Event/EventLanguages/*_Language_RU.txt` | 🔧 backend |
| 5 | Тайвупедия | `EncyclopediaDataProcessor.Init` → `Language_{CurLanguageType}` = **EN** | Postfix геттера `Language` → `Language_RU` | `Language_RU/EncyclopediaAssets/*.tsv` | 🔧 frontend |
| 6 | Тултипы | `ToolTipCommon.LoadConfig` → `Language_{CurLanguageType}/CommonTip` = **EN** | Prefix: грузить из `Language_RU/CommonTip/*.json` (фолбэк EN) | `Language_RU/CommonTip/*.json` | 🔧 frontend |
| 7 | Подсказки опций | `EventModel.LoadEventOptionTipsLanguageFile` грузит EN/CN | Prefix: подставить `EventOptionTips_RU.txt` | `EventLanguages_RU/EventOptionTips_RU.txt` | 🔧 frontend |
| 8 | Языковые картинки (UI) | `LanguageRule(Raw)ImagePattern.RefreshImage` ищет `*_ru`-спрайт, которого нет | Prefix: фолбэк `_ru → en/cn` через `SetSprite/SetTexture` | — | 🔧 frontend |
| 9 | Иконки кнопок/дропдаунов | `CharacterMenuToggleGroup.LoadDropdownEntryButtonSprite`, `ViewCharacterMenuInfo.LoadInteractiveButtonSprite` грузят `_ru`-иконку | Prefix: подставить `en`-путь | — | 🔧 frontend |
| 10 | Ассеты из бандлов | `ResourcePackage.TryGetAssetBundle(LoadData)` не находит `_ru`-ассет | Prefix: переписать токен `_ru → en/cn` (с пробой существования EN) | — | 🔧 frontend |
| 11 | **Картинки внутри Unity-архивов** | Локализованные текстуры (с вшитым кит. текстом) лежат в asset bundle | заменить возвращаемую `Texture2D`/спрайт на нашу переведённую | свои `.png`/бандл | 🔮 future |
| 12 | Шрифт | шрифт игры покрывает кириллицу (RU-мод его не бандлит) | ничего; при пропусках глифов — TMP fallback (техника как у тайского) | (опц.) `.ttf`+атлас | 🔮 при необходимости |

## 3. Картинки в Unity-архивах (отдельно — будущее)

Часть локализованного контента — это **текстуры с вшитым текстом** (заставки, титульные
картинки, кнопки), упакованные в Unity asset bundles. Их не покрывает текстовый перевод.

Уровни решения (по возрастанию сложности):
1. **Фолбэк `_ru → en`** (#8–10) — убирает «дыры»: где нет русской картинки, показываем
   английскую/китайскую. Это не перевод, но не ломает UI. **Делается сейчас.**
2. **Подмена текстуры на лету** (#11) — перехват `ResourcePackage.TryGetAssetBundleLoadData`/
   загрузчика текстур: если запрошен локализуемый ассет и есть наша русская версия —
   подсунуть `Texture2D`, загруженную из нашего `.png` (или из нашего AssetBundle).
   Нужно: каталог «какие ассеты локализуем», наши перерисованные PNG, патч на загрузку.
3. **Свой AssetBundle с RU-текстурами** — собрать бандл переведённых картинок и
   приоритетно отдавать ассеты из него. Самый «чистый», но требует пайплайна сборки бандла.

Это отдельный трек после текстовой локализации.

## 4. Доставка файлов

- **Dev (сейчас):** junction `Language_RU` → `StreamingAssets/Language_RU`, тулчейн пишет
  туда (`npm run apply`). Файлы уже на месте до запуска → авто-дискавери работает.
- **Ship — вариант A (loose):** бандлить `Localization/` внутри мода, копировать в дерево игры
  при загрузке (`DeployFiles`/`CopyTree`, как RU-мод).
- **Ship — вариант B (packed):** упаковать всё в один `.dat` (формат `TWTH`: magic+version+count,
  записи `[isEvent][len+name][len+payload]`) и распаковывать при старте (как тайский мод).
  Чище для Workshop (1 файл вместо ~960).
- **Дозаполнение Тайвупедии:** недостающие `Language_RU/EncyclopediaAssets/*.tsv` копировать
  из `Language_EN` (`FillEncyclopediaGaps`), иначе таблицы пропадут.
- **Гарантия `ui_language.txt`:** обязателен в `Language_RU` (иначе `CollectLanguages` бросит
  исключение и сломает сбор всех языков).

## 5. Инфраструктура

- **csproj:** `GameDir` (override `-p:GameDir`/env `TAIWU_GAME_DIR`), вывод в `dist/Plugins`,
  post-build деплой `dist/ → <game>/Mod/TaiwuRus`.
- **Логи:** свой файл-лог (работает в обоих процессах) + frontend `Debug.Log` (Player.log),
  backend `AdaptableLog`/файл (`Logs/GameData_*.log`).
- **Config.Lua:** один dll в `FrontendPlugins` и `BackendPlugins`; `TagList={Display}`;
  для релиза — `Source=1`, обложка, `GameVersion`.
- **Workshop:** имя папки мода == заголовок в Мастерской (иначе дубль вместо обновления).

## 6. Дорожная карта

- **Phase 0 — точка отсчёта:** положить `Language_RU` тулчейном, убедиться: язык выбирается,
  статика переведена, `ui_language.txt` присутствует. ← *здесь сейчас*
- **Phase 1 — скелет:** одиночный плагин, role-dispatch, грузится в оба процесса, логирует. *(готово в two-project, сворачиваем в single)*
- **Phase 2 — события (backend):** патч `ReloadSinglePackageLanguage` (#4).
- **Phase 3 — текст (frontend):** sorting (#3), encyclopedia (#5), commontip (#6),
  eventoptiontips (#7).
- **Phase 4 — картинки UI:** asset-fallback (#10), language images (#8), button icons (#9).
- **Phase 5 — упаковка:** `.dat`/loose-деплой, `FillEncyclopediaGaps`, self-heal.
- **Phase 6 — релиз:** Config `Source=1`, обложка, описание, заливка в Workshop.
- **Future:**
  - подмена текстур в asset bundles (#11) — перевод картинок;
  - TMP-fallback шрифт (#12), если найдём непокрытые глифы;
  - настройки мода (toggle подсистем), `RegisterGetLanguageCustomHandler` при необходимости;
  - авто-проверка версии игры и предупреждение о несовместимости.

## 7. Проверенные точки API (1.0.40)

backend (`GameData.dll`): `TaiwuEventDomain.ReloadSinglePackageLanguage`, `_languageFilePattern`,
`ReloadAllPackageLanguages`, `EventPackage.InitLanguage`. ·
frontend (`Assembly-CSharp.dll`): `EncyclopediaDataProcessor.Language/Init`,
`ToolTipCommon.LoadConfig`, `EventModel.LoadEventOptionTipsLanguageFile`,
`LanguageRule(Raw)ImagePattern.RefreshImage`, `ResourcePackage.TryGetAssetBundle(LoadData)`,
`Utils_Sorting.LanguageEncodingDict`. ·
shared (`GameData.Shared.dll`): `LocalStringManager` (`CurLanguageKey`, `CurLanguageType`,
private `CollectLanguages`, `Init`, `GetAvailableLanguages`), `LanguageType {CN,EN,KO,CNH,JP}`.
