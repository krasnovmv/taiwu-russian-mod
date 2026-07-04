using System;
using System.IO;
using Config.EventConfig;
using HarmonyLib;
using TaiwuRus.Shared;

namespace TaiwuRus.Backend
{
    /// <summary>
    /// Events/dialogue/quests load via <see cref="EventPackage.InitLanguage"/>, called from
    /// <c>TaiwuEventDomain.ReloadSinglePackageLanguage</c> with the path formatted from
    /// <c>LocalStringManager.CurLanguageType</c> — an enum {CN,EN,KO,CNH,JP} that falls back to
    /// EN for "RU". So for Russian the engine asks for "..._Language_EN.txt".
    ///
    /// We rewrite that argument to "..._Language_RU.txt" when the RU file exists. The TM produces
    /// a complete RU folder (untranslated lines stay English), so loading the RU file alone covers
    /// everything. Typed against public <see cref="EventPackage.InitLanguage"/> — a rename breaks
    /// the BUILD — and uses no private members, so no runtime access-check issues.
    /// </summary>
    [HarmonyPatch(typeof(EventPackage), nameof(EventPackage.InitLanguage))]
    internal static class EventLanguagePatch
    {
        private const string EnSuffix = "_Language_EN.txt";
        private const string RuSuffix = "_Language_RU.txt";

        private static void Prefix(ref string languageFilePath)
        {
            if (!RuLocale.IsRu)
                return;
            if (string.IsNullOrEmpty(languageFilePath)
                || !languageFilePath.EndsWith(EnSuffix, StringComparison.Ordinal))
                return;

            string ru = string.Concat(languageFilePath.AsSpan(0, languageFilePath.Length - EnSuffix.Length), RuSuffix);
            if (File.Exists(ru))
                languageFilePath = ru;
        }
    }
}
