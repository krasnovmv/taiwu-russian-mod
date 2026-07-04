using FrameWork.UI.LanguageRule;
using HarmonyLib;
using TaiwuRus.Shared;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Localized UI graphics (buttons/titles with baked-in text) are atlas sprites named
    /// <c>&lt;base&gt;_&lt;lang&gt;</c>. <see cref="LanguageRuleImagePattern"/> formats its pattern with
    /// <c>GlobalSettings.Language</c> (i.e. "ru") and, if that sprite is missing, falls back to
    /// <c>"cn"</c> — never to English. So under RU these show Chinese, or a blank when there is no CN
    /// variant either.
    ///
    /// This is the LanguageRule entry point into the shared fallback policy: it formats the pattern with
    /// the <c>ru</c> token and hands the resulting name to <see cref="LocalizedImage.ApplySprite"/>,
    /// which is the single definition of RU PNG → EN → CN. Formatting the pattern here (rather than
    /// relying on the trailing-token regex) covers patterns whose language slot is not at the very end.
    ///
    /// Target typed via publicizer nameof (RefreshImage is private); private fields are read via
    /// Harmony `___field` injection (net48-safe).
    /// </summary>
    [HarmonyPatch(typeof(LanguageRuleImagePattern), nameof(LanguageRuleImagePattern.RefreshImage))]
    internal static class ImageOverridePatch
    {
        private static void Postfix(CImage ___targetImage, string ___imagePattern, bool ___nativeSize)
        {
            if (!RuLocale.IsRu || ___targetImage == null || string.IsNullOrEmpty(___imagePattern))
                return;
            LocalizedImage.ApplySpriteFromPattern(___targetImage, ___imagePattern, ___nativeSize);
        }
    }
}
