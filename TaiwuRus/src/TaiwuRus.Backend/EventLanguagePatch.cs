using Config.EventConfig;
using GameData.Domains.TaiwuEvent;
using HarmonyLib;

namespace TaiwuRus.Backend
{
    /// <summary>
    /// Events/dialogue/quests load via <see cref="TaiwuEventDomain.ReloadSinglePackageLanguage"/>,
    /// which formats the per-package pattern "..._Language_{0}.txt" with
    /// <c>LocalStringManager.CurLanguageType</c> — an enum {CN,EN,KO,CNH,JP} that falls back to
    /// EN for "RU". So without this patch every event package loads its English file.
    ///
    /// Typed against the publicized GameData assembly: a rename of the method, the
    /// <c>_languageFilePattern</c> field, or <c>EventPackage.InitLanguage</c> breaks the BUILD.
    /// </summary>
    [HarmonyPatch(typeof(TaiwuEventDomain), nameof(TaiwuEventDomain.ReloadSinglePackageLanguage))]
    internal static class EventLanguagePatch
    {
        private static bool Prefix(EventPackage package)
        {
            // Let the engine handle the built-in languages (CN/EN/KO/CNH/JP) normally.
            if (LocalStringManager.CurLanguageKey != "RU")
                return true;

            if (!TaiwuEventDomain._languageFilePattern.TryGetValue(package, out string pattern)
                || string.IsNullOrEmpty(pattern))
                return false;

            // EN first as the base (covers untranslated packages), then overlay RU where present.
            package.InitLanguage(string.Format(pattern, "EN"));
            package.InitLanguage(string.Format(pattern, "RU"));
            return false;
        }
    }
}
