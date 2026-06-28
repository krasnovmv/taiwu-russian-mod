#!/usr/bin/env python3
"""Extract the bundled EventOptionTips source text into bundle-src/.

EventOptionTips is the only translatable TEXT that lives inside a Unity asset
bundle (GameResources/language_eventoptiontips.uab) rather than the StreamingAssets
Language_* pack. This pulls its EN + CN TextAssets out as loose .txt so the normal
pipeline (scan -> translate -> apply) can treat them as a source family.

Re-run after a game update if the bundle changed.

    pip install UnityPy
    python tools/extract-option-tips.py                 # auto-detect via TAIWU_GAME_DIR / default
    python tools/extract-option-tips.py "<game dir>"    # explicit install root
"""
import os
import sys

import UnityPy

DEFAULT_GAME = os.environ.get(
    "TAIWU_GAME_DIR",
    r"D:/SteamLibrary/steamapps/common/The Scroll Of Taiwu",
)
BUNDLE_REL = "The Scroll of Taiwu_Data/GameResources/language_eventoptiontips.uab"
WANT = ("EventOptionTips_EN", "EventOptionTips_CN")  # source + reference
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "bundle-src", "Language_EventOptionTips")


def main() -> int:
    game = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_GAME
    bundle = os.path.join(game, BUNDLE_REL)
    if not os.path.isfile(bundle):
        print(f"bundle not found: {bundle}", file=sys.stderr)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    env = UnityPy.load(bundle)
    written = 0
    for o in env.objects:
        if o.type.name != "TextAsset":
            continue
        d = o.read()
        name = getattr(d, "m_Name", None) or getattr(d, "name", "")
        if name not in WANT:
            continue
        script = getattr(d, "m_Script", None)
        if script is None:
            script = getattr(d, "text", "")
        data = script.encode("utf-8", "surrogateescape") if isinstance(script, str) else bytes(script)
        with open(os.path.join(OUT_DIR, name + ".txt"), "wb") as f:
            f.write(data)
        print(f"  wrote {name}.txt ({len(data)} bytes)")
        written += 1

    if written != len(WANT):
        print(f"warning: expected {len(WANT)} assets, wrote {written}", file=sys.stderr)
    print(f"-> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
