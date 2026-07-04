using FrameWork.UI.LanguageRule;
using FrameWork.UISystem.UIElements;
using HarmonyLib;
using TaiwuRus.Shared;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Some icons are set by game code that builds a localized atlas-sprite name
    /// <c>&lt;base&gt;_&lt;lang&gt;</c> and calls <c>CImage.SetSprite</c> directly — bypassing
    /// <see cref="LanguageRuleImagePattern"/> and <see cref="ImageOverridePatch"/>. The combat
    /// trick/skill plates in <c>ViewCombat</c> are the case that surfaced this
    /// (<c>ui9_combat_trick_name_&lt;n&gt;_ru</c>).
    ///
    /// This is the universal choke-point for code-set sprites: any <c>SetSprite</c> whose name carries a
    /// trailing <c>_ru</c> token is routed through <see cref="LocalizedImage.ApplySprite"/> — the single
    /// definition of RU PNG → EN → CN — and the original call is skipped. Non-<c>_ru</c> names (the vast
    /// majority of SetSprite calls) pass straight through untouched.
    /// </summary>
    [HarmonyPatch(typeof(CImage), nameof(CImage.SetSprite))]
    internal static class SpriteLanguageFallbackPatch
    {
        private static bool Prefix(CImage __instance, string spriteName, bool autoNativeSize)
        {
            if (!RuLocale.IsRu || !RuImageName.HasRuToken(spriteName))
                return true; // not a localized name → run the stock method
            LocalizedImage.ApplySprite(__instance, spriteName, autoNativeSize);
            return false; // fully handled
        }
    }
}
