using System.Collections.Generic;
using FrameWork.UI.LanguageRule;
using FrameWork.UISystem.UIElements;
using HarmonyLib;
using TaiwuRus.Shared;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Permanent, low-noise diagnostic. Under RU, logs each UNIQUE sprite/texture name the engine
    /// fails to resolve — it silently <c>SetEnabled(false)</c>s on a miss, so nothing else reaches the
    /// log and a blank icon is otherwise invisible to debugging. One line per name (deduped), so it
    /// stays quiet in normal play and instantly names the culprit when something shows up blank.
    ///
    /// Grep the log for <c>[TaiwuRus][miss]</c>. A <c>_en</c> name here means even English is missing
    /// (the sprite genuinely isn't in the atlas under that name); a non-language name means game code
    /// asked for a sprite that doesn't exist. Names already redirected by
    /// <see cref="SpriteLanguageFallbackPatch"/> (so they resolved) never appear.
    /// </summary>
    [HarmonyPatch]
    internal static class SpriteMissLog
    {
        private static readonly HashSet<string> Seen = new HashSet<string>();

        private static void Report(string kind, string name)
        {
            if (!RuLocale.IsRu || string.IsNullOrEmpty(name))
                return;
            if (Seen.Add(kind + ":" + name))
                Debug.Log($"[TaiwuRus][miss] {kind} not found: '{name}'");
        }

        [HarmonyPostfix]
        [HarmonyPatch(typeof(CImage), nameof(CImage.SetSprite))]
        private static void AfterSetSprite(CImage __instance, string spriteName)
        {
            // SetSprite enables the image on success and disables it on a miss.
            if (__instance != null && !__instance.enabled)
                Report("sprite", spriteName);
        }

        [HarmonyPostfix]
        [HarmonyPatch(typeof(CRawImage), nameof(CRawImage.SetTexture))]
        private static void AfterSetTexture(string textureName, bool __result)
        {
            if (!__result) // SetTexture returns false when the texture isn't found
                Report("texture", textureName);
        }
    }
}
