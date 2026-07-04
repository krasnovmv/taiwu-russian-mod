using System;
using FrameWork.UISystem.UIElements;
using Game.Views.CharacterMenu;
using HarmonyLib;
using TaiwuRus.Shared;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// CharacterMenu tab buttons load their icon states straight through
    /// <c>ResLoader.Load&lt;Sprite&gt;</c>, formatting a per-tab pattern
    /// <c>RemakeResources/UIGraphics5.0/Ui9CharacterMenu/ui9_btn_&lt;tab&gt;_{0}_{1}</c> with
    /// {0}=UI language lowercased and {1}=state index. This path does NOT go through
    /// <c>LanguageRuleImagePattern</c>, so it never maps RU→EN: under RU it asks for non-existent
    /// <c>_ru</c> sprites, flooding the log with "[ResLoader]: Failed to load resource" and leaving
    /// blank tab icons.
    ///
    /// We replace the loader for RU only (other languages keep the stock method) and reproduce the
    /// original's four states exactly via <see cref="LocalizedImage.ApplyButtonStates"/> — the shared
    /// RU PNG → EN → CN policy:
    ///   • normal      → <c>Image.sprite</c>               state = isCurrent ? 2 : 0
    ///   • highlighted + selected → <c>SpriteState</c>     state = isCurrent ? 2 : 1
    ///   • pressed     → <c>SpriteState</c>                state = 0
    ///   • disabled    → <c>SpriteState</c>                state = 3
    ///
    /// NB: a per-call-site patch on purpose. The shared loader <c>ResLoader.Load&lt;Sprite&gt;</c> is a
    /// generic method; patching it leaks to every reference-type <c>Load&lt;T&gt;</c> under Mono code-
    /// sharing and breaks prefab/atlas loads — so we patch the concrete (non-generic) button method.
    /// </summary>
    [HarmonyPatch(typeof(CharacterMenuToggleGroup), "LoadDropdownEntryButtonSprite")]
    internal static class CharacterMenuButtonSpritePatch
    {
        private static readonly Action<string, Action<Sprite?>> ResLoad =
            (p, cb) => ResLoader.Load<Sprite>(p, cb);

        private static bool Prefix(CButton btn, string path, bool isCurrent)
        {
            if (!RuLocale.IsRu || btn == null || string.IsNullOrEmpty(path))
                return true; // not RU (or nothing to load) → run the stock method

            LocalizedImage.ApplyButtonStates(btn, path, ResLoad,
                normal: isCurrent ? 2 : 0, highlighted: isCurrent ? 2 : 1, pressed: 0, disabled: 3);
            return false; // skip the stock method
        }
    }
}
