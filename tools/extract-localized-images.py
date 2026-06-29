#!/usr/bin/env python3
"""Extract every localized UI image (the ones with baked-in text) to image-src/.

Localized graphics live as Texture2D/Sprite inside GameResources/*.uab, named
"<base>_<lang>_<...>". Many textures keep their pixel data in a SEPARATE dependency
bundle (a `cab-*` file), so loading bundles one-by-one fails to decode them. We load
the whole GameResources tree into ONE UnityPy environment so those cross-bundle
references resolve, then save EN (preferred, else first available) of each image as a
browsable PNG named exactly as the in-game asset.

    pip install UnityPy
    python tools/extract-localized-images.py
"""
import os
import re
import sys

import UnityPy

GAME = os.environ.get("TAIWU_GAME_DIR", r"D:/SteamLibrary/steamapps/common/The Scroll Of Taiwu")
GR = os.path.join(GAME, "The Scroll of Taiwu_Data", "GameResources")
OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "image-src")

LANG = re.compile(r"_(en|cn|cnh|ko|jp)(?=$|[_.])", re.I)
PREF = ["en", "cn", "cnh", "ko", "jp"]  # which variant to export, in order


def main() -> int:
    if not os.path.isdir(GR):
        print(f"GameResources not found: {GR}", file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)

    print("loading whole GameResources env (this is the slow part)...", flush=True)
    env = UnityPy.load(GR)

    # group -> {lang: reader}
    groups = {}
    n = 0
    for o in env.objects:
        if o.type.name not in ("Texture2D", "Sprite"):
            continue
        n += 1
        if n % 5000 == 0:
            print(f"  scanned {n} image objects, {len(groups)} groups", flush=True)
        try:
            nm = o.read().m_Name
        except Exception:
            continue
        if not nm:
            continue
        m = LANG.search(nm)
        if not m:
            continue
        base = nm[: m.start()] + nm[m.end():]
        groups.setdefault(base, {})[m.group(1).lower()] = (nm, o)

    print(f"localized groups: {len(groups)}; exporting...", flush=True)
    written, names, failed = 0, [], 0
    for base, variants in groups.items():
        lang = next((l for l in PREF if l in variants), None)
        if lang is None:
            continue
        nm, o = variants[lang]
        try:
            o.read().image.save(os.path.join(OUT, nm + ".png"))
            names.append(nm)
            written += 1
        except Exception:
            failed += 1

    with open(os.path.join(OUT, "_index.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(names)) + "\n")
    print(f"\nlocalized groups: {len(groups)}; exported: {written}; failed: {failed}")
    print(f"-> {OUT}  (see _index.txt)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
