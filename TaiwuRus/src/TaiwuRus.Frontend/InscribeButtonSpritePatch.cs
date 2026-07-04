using System;
using FrameWork.UISystem.UIElements;
using Game.Views.CharacterMenu;
using HarmonyLib;
using TaiwuRus.Shared;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// The CharacterMenu "inscribe" (mirror) button loads its icon states through
    /// <c>ViewCharacterMenuInfo.LoadInteractiveButtonSprite(CButton, string)</c>, formatting the
    /// per-state pattern <c>ui9_btn_mirro_{0}_{1}</c> ({0}=language, {1}=state) and loading it via
    /// <c>ResLoader.Load&lt;Sprite&gt;</c>. Like the tab buttons (see
    /// <see cref="CharacterMenuButtonSpritePatch"/>), this path does NOT go through
    /// <c>LanguageRuleImagePattern</c>, so under RU it asks for non-existent <c>_ru</c> atlas sprites.
    ///
    /// We replace the loader for RU only (other languages keep the stock method) and reproduce the
    /// original's four states exactly — normal (0), highlighted+selected (1), pressed (2),
    /// disabled (3) — via <see cref="LocalizedImage.ApplyButtonStates"/>, the shared
    /// RU PNG → EN → CN policy.
    ///
    /// Patched at this concrete (non-generic) method on purpose: the shared loader
    /// <c>ResLoader.Load&lt;Sprite&gt;</c> is generic, and patching it leaks to every reference-type
    /// <c>Load&lt;T&gt;</c> under Mono code-sharing (breaking prefab/atlas loads).
    /// </summary>
    [HarmonyPatch(typeof(ViewCharacterMenuInfo), "LoadInteractiveButtonSprite")]
    internal static class InscribeButtonSpritePatch
    {
        private static readonly Action<string, Action<Sprite?>> ResLoad =
            (p, cb) => ResLoader.Load<Sprite>(p, cb);

        private static bool Prefix(CButton btn, string path)
        {
            if (!RuLocale.IsRu || btn == null || string.IsNullOrEmpty(path))
                return true; // not RU (or nothing to load) → run the stock method

            LocalizedImage.ApplyButtonStates(btn, path, ResLoad,
                normal: 0, highlighted: 1, pressed: 2, disabled: 3);
            return false; // skip the stock method
        }
    }
}
