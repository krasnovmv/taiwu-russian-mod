using FrameWork.UI.LanguageRule;
using HarmonyLib;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// The <see cref="CRawImage"/> counterpart of <see cref="SpriteLanguageFallbackPatch"/>. Some
    /// RawImage textures are set by game code that builds a localized name <c>&lt;base&gt;_&lt;lang&gt;</c>
    /// and calls <c>CRawImage.SetTexture</c> directly — bypassing <see cref="LanguageRuleRawImagePattern"/>
    /// and <see cref="RawImageOverridePatch"/>. The cricket minigame is where this surfaced
    /// (<c>CricketPlaceInfo.SetTextureWithLang</c> poem/name plates, and
    /// <c>CricketCombatStartButton</c>'s <c>ui9_tex_cricketcombat_title_&lt;n&gt;_ru</c>).
    ///
    /// This is the universal choke-point for code-set textures: any <c>SetTexture</c> whose name carries a
    /// trailing <c>_ru</c> token is routed through <see cref="LocalizedImage.ApplyTexture"/> — the single
    /// definition of RU PNG → EN → CN — and the original call is skipped (its bool result reproduced via
    /// <c>__result</c>). Non-<c>_ru</c> names pass straight through untouched.
    /// </summary>
    [HarmonyPatch(typeof(CRawImage), nameof(CRawImage.SetTexture), new[] { typeof(string) })]
    internal static class RawTextureLanguageFallbackPatch
    {
        private static bool Prefix(CRawImage __instance, string textureName, ref bool __result)
        {
            if (!LocalizedImage.IsRu || !LocalizedImage.HasRuToken(textureName))
                return true; // not a localized name → run the stock method
            __result = LocalizedImage.ApplyTexture(__instance, textureName);
            return false; // fully handled
        }
    }
}
