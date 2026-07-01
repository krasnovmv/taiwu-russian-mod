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
rem  This script lives in ...\Mod\TaiwuRus\ - game root is two levels up.
rem  ASCII-only on purpose: a .bat with non-ASCII text mis-parses under
rem  the wrong console code page. Messages are English by design.
rem =====================================================================

set "MODROOT=%~dp0"
for %%I in ("%MODROOT%..\..") do set "GAMEROOT=%%~fI"

if not exist "%GAMEROOT%" (
    echo [TaiwuRus] Could not resolve the game root from "%MODROOT%".
    pause
    exit /b 1
)

echo [TaiwuRus] Game root: "%GAMEROOT%"
echo.

set /a dirs=0, files=0

rem --- 1) Whole RU folders (Language_RU, EventLanguages_RU, ...) ---
rem     Skip the mod itself (%MODROOT%\Localization) - that is the source
rem     overlay; deleting it would wipe the mod's own payload.
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
echo            delete the mod (the Mod\TaiwuRus folder).
echo.
pause
