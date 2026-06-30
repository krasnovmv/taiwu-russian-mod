using System;
using System.Text.RegularExpressions;
using FrameWork.UI.LanguageRule;
using FrameWork.UISystem.UIElements;
using HarmonyLib;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Some icons are set by game code that builds a localized atlas-sprite name
    /// <c>&lt;base&gt;_&lt;lang&gt;</c> and calls <c>CImage.SetSprite</c> directly — bypassing
    /// <see cref="LanguageRuleImagePattern"/> and our <see cref="ImageOverridePatch"/>. The combat
    /// trick/skill plates in <c>ViewCombat</c> are the case that surfaced this
    /// (<c>ui9_combat_trick_name_&lt;n&gt;_ru</c>). The atlases ship no <c>_ru</c> variant (RU graphics
    /// are PNG overrides, not atlas sprites), so under RU these names resolve to nothing and
    /// <c>SetSprite</c> silently blanks the image — with no error in the log.
    ///
    /// One non-generic choke-point fixes them all: redirect a trailing <c>_ru</c> language token to
    /// <c>_en</c> so the English atlas sprite loads — the same English fallback the rest of the pack
    /// uses. Any future code-set <c>_ru</c> icon is covered automatically.
    /// </summary>
    [HarmonyPatch(typeof(CImage), nameof(CImage.SetSprite))]
    internal static class SpriteLanguageFallbackPatch
    {
        // A trailing language token: "<base>_ru" or "<base>_ru_<state>". Anchored to the end so a
        // stray "ru" inside a name (e.g. "ruin") is never matched.
        private static readonly Regex RuToken = new Regex(@"_ru(?=(_\d+)?$)");

        private static void Prefix(ref string spriteName)
        {
            if (LocalStringManager.CurLanguageKey != "RU" || string.IsNullOrEmpty(spriteName))
                return;
            // Cheap guard so the regex runs only for names that actually carry a "_ru" segment.
            if (spriteName.IndexOf("_ru", StringComparison.Ordinal) >= 0)
                spriteName = RuToken.Replace(spriteName, "_en");
        }
    }
}
