<#
.SYNOPSIS
Recreate the gitignored junctions that connect this repo to the game install.

.DESCRIPTION
The pipeline reads the game's language files through junctions in the repo root
(Language_EN, Language_CN, Event_Languages, Event_DLC\<DLC>). They are all
gitignored, so a fresh clone or a new git worktree has NONE of them, and most
discovery degrades softly when they are missing (0 files found), which once
cost a session of confusion. Run this script once per clone/worktree.

ASCII-only on purpose: PowerShell 5.1 reads a BOM-less file as ANSI, and a
multi-byte character can decode to a stray quote that breaks parsing.

The DLC list is discovered, not hardcoded: any <game>_Data subfolder that keeps
versioned quest packs (<version>\Events\EventLanguages) gets a junction, so new
expansions are picked up by re-running the script after a game update.

Junctions (not symlinks) on purpose: they need no admin rights and no developer
mode. Safe to re-run — existing links are left alone.

.PARAMETER GameDir
Game install root. Defaults to $env:TAIWU_GAME_DIR, then the standard Steam path.

.EXAMPLE
powershell -File tools/setup-junctions.ps1
powershell -File tools/setup-junctions.ps1 -GameDir "E:\Steam\steamapps\common\The Scroll Of Taiwu"
#>
param(
    [string]$GameDir = $(if ($env:TAIWU_GAME_DIR) { $env:TAIWU_GAME_DIR }
                         else { "D:\SteamLibrary\steamapps\common\The Scroll Of Taiwu" })
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$data = Join-Path $GameDir "The Scroll of Taiwu_Data"
$streaming = Join-Path $data "StreamingAssets"

if (-not (Test-Path (Join-Path $streaming "Language_EN"))) {
    Write-Error ("game not found under '$GameDir' (no StreamingAssets\Language_EN). " +
        "Pass -GameDir or set TAIWU_GAME_DIR to the install root.")
}

function New-RepoJunction([string]$Name, [string]$Target) {
    $link = Join-Path $repo $Name
    if (Test-Path $link) {
        Write-Host "  = $Name (already exists)"
    } elseif (-not (Test-Path $Target)) {
        Write-Host "  ! $Name skipped: target missing ($Target)"
    } else {
        New-Item -ItemType Junction -Path $link -Target $Target | Out-Null
        Write-Host "  + $Name -> $Target"
    }
}

Write-Host "Repo: $repo"
Write-Host "Game: $GameDir"
Write-Host "Junctions:"

# Read by the pipeline (src/config/paths.ts).
New-RepoJunction "Language_EN" (Join-Path $streaming "Language_EN")
New-RepoJunction "Language_CN" (Join-Path $streaming "Language_CN")
New-RepoJunction "Event_Languages" (Join-Path $GameDir "Event\EventLanguages")

# Convenience only (inspect the stock KO pack / the deployed RU output in place);
# the pipeline itself resolves output through the Language_EN junction target.
New-RepoJunction "Language_KO" (Join-Path $streaming "Language_KO")
New-RepoJunction "Language_RU" (Join-Path $streaming "Language_RU")

# Per-DLC quest packs: every *_Data subfolder holding <version>\Events\EventLanguages.
$eventDlc = Join-Path $repo "Event_DLC"
if (-not (Test-Path $eventDlc)) { New-Item -ItemType Directory -Path $eventDlc | Out-Null }
foreach ($dlc in Get-ChildItem $data -Directory) {
    $isDlc = Get-ChildItem $dlc.FullName -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "Events\EventLanguages") }
    if ($isDlc) {
        New-RepoJunction (Join-Path "Event_DLC" $dlc.Name) $dlc.FullName
    }
}

Write-Host ""
Write-Host "Junctions are only part of a fresh-machine setup; also (see README):"
Write-Host "  - copy .env from another checkout (or from .env.example); a missing .env"
Write-Host "    silently changes output routing"
Write-Host "  - yc init                  (Yandex credentials for translate/judge)"
Write-Host "  - pip install UnityPy      (only for tools/extract-*.py)"
