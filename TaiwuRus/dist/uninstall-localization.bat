@echo off
setlocal EnableDelayedExpansion

rem =====================================================================
rem  TaiwuRus - remove the Russian localization copied into the game.
rem
rem  On launch the plugin copies Russian files into the game tree. Every
rem  such artifact is RU-marked and comes in two shapes:
rem    * whole folders   ...\StreamingAssets\Language_RU
rem                      ...\StreamingAssets\EventLanguages_RU
rem    * loose files     *_Language_RU.txt  (mixed with the EN/CN files
rem      in the shared Event\EventLanguages folder and in the DLCs).
rem
rem  The game ships no native RU slot, so everything RU-marked is ours and
rem  is removed by name. This scans the game root directly, so it works
rem  even after the mod overlay has been deleted.
rem
rem  The script must find the game root no matter where the mod folder it
rem  lives in sits. Two shipping layouts are supported:
rem    * dev deploy      ...\<game>\Mod\TaiwuRus\      -> game root is two
rem                                                       levels up.
rem    * Steam Workshop  ...\steamapps\workshop\content\838350\<id>\
rem                      -> the game install is a sibling under the same
rem                         Steam library: ...\steamapps\common\<game>.
rem  In both cases the real game root is identified by its signature marker
rem  <root>\*_Data\StreamingAssets\Language_EN\ui_language.txt, so we never
rem  hard-code the install folder name.
rem
rem  ASCII-only on purpose: a .bat with non-ASCII text mis-parses under
rem  the wrong console code page. Messages are English by design.
rem =====================================================================

set "MODROOT=%~dp0"
set "GAMEROOT="

rem --- Layout 1: dev deploy - game root is two levels up from the mod. ---
for %%I in ("%MODROOT%..\..") do set "CAND=%%~fI"
call :hasGame "%CAND%" && set "GAMEROOT=%CAND%"

rem --- Layout 2: Steam Workshop - the mod sits four levels below the ---
rem     library's steamapps folder; the game is under steamapps\common.
if not defined GAMEROOT (
    for %%I in ("%MODROOT%..\..\..\..") do set "STEAMAPPS=%%~fI"
    if exist "!STEAMAPPS!\common\" (
        for /d %%G in ("!STEAMAPPS!\common\*") do (
            if not defined GAMEROOT (
                call :hasGame "%%~fG" && set "GAMEROOT=%%~fG"
            )
        )
    )
)

if not defined GAMEROOT (
    echo [TaiwuRus] Could not locate the Taiwu game install from
    echo            "%MODROOT%".
    echo            Expected either ...\^<game^>\Mod\TaiwuRus\ or a Steam
    echo            Workshop folder next to ...\steamapps\common\^<game^>.
    pause
    exit /b 1
)

echo [TaiwuRus] Game root: "%GAMEROOT%"
echo.

set /a dirs=0, files=0

rem --- 1) Whole RU folders (Language_RU, EventLanguages_RU, ...) ---
rem     Skip the mod itself (%MODROOT%\Localization) - that is the source
rem     overlay; deleting it would wipe the mod's own payload. (In the
rem     Workshop layout the mod is outside the game root, so nothing here
rem     matches it anyway; the guard only matters for the dev deploy.)
for /d /r "%GAMEROOT%" %%D in (*_RU) do (
    set "P=%%D"
    if "!P:%MODROOT%=!"=="!P!" (
        rd /s /q "%%D" 2>nul
        if exist "%%D" (
            echo   ! failed to remove folder: "%%D"
        ) else (
            echo   - folder: "%%D"
            set /a dirs+=1
        )
    )
)

rem --- 2) Loose *_Language_RU.txt files in shared folders (not the overlay) ---
for /r "%GAMEROOT%" %%F in (*_Language_RU.txt) do (
    set "P=%%F"
    if "!P:%MODROOT%=!"=="!P!" (
        del /q "%%F" 2>nul
        if exist "%%F" (
            echo   ! failed to remove file: "%%F"
        ) else (
            set /a files+=1
        )
    )
)

echo.
echo [TaiwuRus] Removed RU folders: !dirs!,  RU files: !files!.
echo.
echo [TaiwuRus] Note: with the mod still enabled, the files are copied
echo            again on the next launch. To keep them gone, disable or
echo            delete the mod (unsubscribe in the Workshop, or delete
echo            the Mod\TaiwuRus folder for a manual install).
echo.
pause
exit /b 0

rem ---------------------------------------------------------------------
rem  :hasGame <path>  -> exit code 0 if <path> looks like the Taiwu game
rem  root (has <path>\*_Data\StreamingAssets\Language_EN\ui_language.txt),
rem  else 1. Used to pick the right candidate among several.
rem ---------------------------------------------------------------------
:hasGame
for /d %%D in ("%~1\*_Data") do (
    if exist "%%D\StreamingAssets\Language_EN\ui_language.txt" exit /b 0
)
exit /b 1
