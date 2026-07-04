using FrameWork.UI.LanguageRule;
using HarmonyLib;
using TaiwuRus.Shared;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Most localized UI graphics are raw <c>Texture2D</c> shown through
    /// <see cref="LanguageRuleRawImagePattern"/> (CRawImage), named
    /// <c>&lt;…&gt;_&lt;lang&gt;_&lt;…&gt;</c>. RefreshImage formats the pattern with
    /// <c>GlobalSettings.Language</c> (i.e. "ru") and calls SetTexture once — with NO language
    /// fallback at all. So under RU, where no `_ru` texture exists, the RawImage is left blank.
    ///
    /// This is the RawImage entry point into the shared fallback policy: it formats the pattern with the
    /// <c>ru</c> token and hands the resulting name to <see cref="LocalizedImage.ApplyTexture"/>, the
    /// single definition of RU PNG → EN → CN. Formatting the pattern here (rather than relying on the
    /// trailing-token regex) covers patterns whose language slot is not at the very end.
    /// </summary>
    [HarmonyPatch(typeof(LanguageRuleRawImagePattern), nameof(LanguageRuleRawImagePattern.RefreshImage))]
    internal static class RawImageOverridePatch
    {
        private static void Postfix(CRawImage ___targetImage, string ___imagePattern)
        {
            if (!RuLocale.IsRu || ___targetImage == null || string.IsNullOrEmpty(___imagePattern))
                return;
            LocalizedImage.ApplyTextureFromPattern(___targetImage, ___imagePattern);
        }
    }
}
