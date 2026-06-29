using System;
using System.IO;
using Game.Views.Encyclopedia;
using HarmonyLib;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Taiwupedia builds its .tsv path from <see cref="EncyclopediaDataProcessor.Language"/>,
    /// which is set to "Language_" + <c>LocalStringManager.CurLanguageType</c> — an enum
    /// {CN,EN,KO,CNH,JP} that falls back to EN for "RU". So the encyclopedia reads
    /// Language_EN/EncyclopediaAssets/*.tsv.
    ///
    /// Force the public getter to report "Language_RU" while RU is selected, so the tables load
    /// from our RU folder. Fully typed (public getter + public CurLanguageKey); no private access.
    ///
    /// The redirect is suppressed per-table by <see cref="EncyclopediaGapFillPatch"/> when a
    /// table has no RU translation yet — see <see cref="SuppressRu"/>.
    /// </summary>
    [HarmonyPatch(typeof(EncyclopediaDataProcessor), nameof(EncyclopediaDataProcessor.Language), MethodType.Getter)]
    internal static class EncyclopediaLanguagePatch
    {
        /// <summary>
        /// While true, the getter leaves the engine's EN value untouched. Set for the duration of
        /// a single <c>GetTable</c> call whose RU .tsv is missing so that one table loads in
        /// English instead of breaking; reset immediately after. See <see cref="EncyclopediaGapFillPatch"/>.
        /// </summary>
        internal static bool SuppressRu;

        private static void Postfix(ref string __result)
        {
            if (SuppressRu || LocalStringManager.CurLanguageKey != "RU")
                return;
            if (__result != null && __result != "Language_RU"
                && __result.StartsWith("Language_", StringComparison.Ordinal))
                __result = "Language_RU";
        }
    }

    /// <summary>
    /// Per-table gap fill. <c>EncyclopediaDataProcessor.GetTable(name)</c> builds
    /// <c>StreamingAssets/&lt;Language&gt;/EncyclopediaAssets/&lt;name&gt;.tsv</c> from the (patched)
    /// <see cref="EncyclopediaDataProcessor.Language"/> getter and reads it. If a table has no RU
    /// .tsv (e.g. a new table added by a game update) but the EN one exists, suppress the RU
    /// redirect for just that call so the engine loads the English table — better than a missing
    /// file (broken/blank entry). Tables WITH a RU file are unaffected.
    /// </summary>
    [HarmonyPatch(typeof(EncyclopediaDataProcessor), nameof(EncyclopediaDataProcessor.GetTable))]
    internal static class EncyclopediaGapFillPatch
    {
        private static void Prefix(string __0)
        {
            EncyclopediaLanguagePatch.SuppressRu = false;
            if (LocalStringManager.CurLanguageKey != "RU" || string.IsNullOrEmpty(__0))
                return;

            string ru = Path.Combine(Application.streamingAssetsPath, "Language_RU", "EncyclopediaAssets", __0 + ".tsv");
            if (File.Exists(ru))
                return; // RU table present — load it normally

            string en = Path.Combine(Application.streamingAssetsPath, "Language_EN", "EncyclopediaAssets", __0 + ".tsv");
            if (File.Exists(en))
                EncyclopediaLanguagePatch.SuppressRu = true; // no RU table — fall back to EN
        }

        // Reset even if GetTable throws, so the flag never leaks into an unrelated Language read.
        private static void Finalizer()
        {
            EncyclopediaLanguagePatch.SuppressRu = false;
        }
    }
}
