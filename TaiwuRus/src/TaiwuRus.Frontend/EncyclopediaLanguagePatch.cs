using System;
using Game.Views.Encyclopedia;
using HarmonyLib;

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
    /// </summary>
    [HarmonyPatch(typeof(EncyclopediaDataProcessor), nameof(EncyclopediaDataProcessor.Language), MethodType.Getter)]
    internal static class EncyclopediaLanguagePatch
    {
        private static void Postfix(ref string __result)
        {
            if (LocalStringManager.CurLanguageKey != "RU")
                return;
            if (__result != null && __result != "Language_RU"
                && __result.StartsWith("Language_", StringComparison.Ordinal))
                __result = "Language_RU";
        }
    }
}
