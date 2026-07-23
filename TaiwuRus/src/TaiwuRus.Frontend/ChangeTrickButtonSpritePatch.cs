using System;
using FrameWork.UISystem.UIElements;
using Game.Views.Combat;
using HarmonyLib;
using TaiwuRus.Shared;
using UnityEngine;
using UnityEngine.UI;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// The combat "change trick" wheel buttons (破绽/封穴/变招) load their graphics in code:
    /// <see cref="ViewCombat"/>'s <c>UpdateChangeTrickButtonSprite</c> formats
    /// <c>Combat/ui9_combat_roulette_btn_&lt;type&gt;_0_&lt;lang&gt;</c> (and <c>_4_</c> for the disabled
    /// state) with <c>GlobalSettings.Language</c> (i.e. "ru") and loads it through
    /// <c>ResLoader.LoadModOrGameResource</c> — a path that goes through neither
    /// <see cref="LanguageRuleImagePattern"/> nor <see cref="SpriteLanguageFallbackPatch"/>. The stock
    /// code falls back only to <c>_cn</c>, so under RU it first asks for a non-existent <c>_ru</c> sprite
    /// (flooding the log with "[ResLoader]: Failed to load resource") and then shows the Chinese button.
    ///
    /// We replace the loader for RU only, reproducing the original's states (normal — reused for
    /// highlighted/pressed/selected — plus the <c>_4_</c> disabled sprite) but routing each through
    /// <see cref="LocalizedImage.LoadSprite"/>, the single RU PNG → EN → CN policy, so the fallback order
    /// matches every other localized image.
    ///
    /// Patched at this concrete (non-generic) method on purpose: <c>LoadModOrGameResource&lt;T&gt;</c> is
    /// generic, and patching it leaks to every reference-type load under Mono code-sharing.
    /// </summary>
    [HarmonyPatch(typeof(ViewCombat), "UpdateChangeTrickButtonSprite")]
    internal static class ChangeTrickButtonSpritePatch
    {
        private static readonly Action<string, Action<Sprite?>> ModLoad =
            (p, cb) => ResLoader.LoadModOrGameResource<Sprite>(p, cb);

        private static bool Prefix(CButton button, string type)
        {
            if (!RuLocale.IsRu || button == null)
                return true; // not RU → run the stock method

            if (!(button.image is CImage image))
                return false; // nothing we can set; skip the stock _ru load

            string baseName = "Combat/ui9_combat_roulette_btn_" + type;

            LocalizedImage.LoadSprite(baseName + "_0_ru", ModLoad, normal =>
            {
                // The EN/CN fallback loads async: combat may have closed by now, destroying
                // the button. Unity's overloaded == reports a destroyed object as null.
                if (normal == null || image == null || button == null)
                    return;
                image.sprite = normal;
                image.SetEnabled(true);

                SpriteState spriteState = button.spriteState;
                spriteState.highlightedSprite = normal;
                spriteState.pressedSprite = normal;
                spriteState.selectedSprite = normal;
                button.spriteState = spriteState;

                LocalizedImage.LoadSprite(baseName + "_4_ru", ModLoad, disabled =>
                {
                    if (button == null)
                        return; // destroyed while the disabled state was loading
                    SpriteState s = button.spriteState;
                    s.disabledSprite = disabled;
                    button.spriteState = s;
                });
            });

            return false; // skip the stock method
        }
    }
}
