using System;
using Game.Components.Adventure;
using HarmonyLib;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// The "adventure / major-event complete" splash (<see cref="AdventureRemakeFinish"/>) renders its
    /// title as baked art — GameObjects + Renderers held in a serialized <c>localizationTitles</c> array,
    /// one entry per <c>languageId</c>. The prefab ships cn/en/ko only, so under RU the engine's
    /// <c>OnLanguageChange</c> finds no "ru" entry, logs
    /// <c>[AdventureRemakeFinish]Language ru not found in localizationTitles!</c>, and falls back to
    /// index 0 — the Chinese title (奇遇完成). There is no RU art to inject, so mirror the project's
    /// per-subsystem RU→EN fallback: when the active language has no entry, re-point to the "en" one
    /// (English "Adventure Complete") instead of Chinese, and re-run the private refresh.
    ///
    /// Gated on RU only, like every other subsystem here (<see cref="LocalizedImage.IsRu"/>): a
    /// player on any other language keeps the engine's own resolution untouched, even if their
    /// language also lacks an entry (e.g. jp/cnh → Chinese, as vanilla). If there's no "en" entry to
    /// fall back to, we leave the engine's index-0 fallback alone.
    /// </summary>
    [HarmonyPatch(typeof(AdventureRemakeFinish), nameof(AdventureRemakeFinish.OnLanguageChange))]
    internal static class AdventureFinishTitlePatch
    {
        private static void Postfix(AdventureRemakeFinish __instance)
        {
            if (!LocalizedImage.IsRu)
                return;

            AdventureRemakeFinish.LocalizationTitles[] titles = __instance.localizationTitles;
            if (titles == null || titles.Length == 0)
                return;

            string lang = __instance.currentLanguage; // engine already lowercased GlobalSettings.Language

            int enIndex = -1;
            for (int i = 0; i < titles.Length; i++)
            {
                // Active language has its own entry — the engine resolved correctly, don't touch it.
                if (string.Equals(titles[i].languageId, lang, StringComparison.OrdinalIgnoreCase))
                    return;
                if (enIndex < 0 && string.Equals(titles[i].languageId, "en", StringComparison.OrdinalIgnoreCase))
                    enIndex = i;
            }

            if (enIndex < 0 || enIndex == __instance.currentLanguageIndex)
                return; // no English entry to fall back to, or already on it

            __instance.currentLanguageIndex = enIndex;
            __instance.RefreshLanguage();
            Debug.Log($"[TaiwuRus] AdventureRemakeFinish: '{lang}' has no title art; fell back to EN");
        }
    }
}
