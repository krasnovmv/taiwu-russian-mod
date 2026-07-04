using System;
using System.Text.RegularExpressions;

namespace TaiwuRus.Shared
{
    /// <summary>
    /// The <c>_ru</c> language-token grammar of localized image names: detection and rewriting to
    /// the EN/CN variants. Pure string logic (no Unity types) so it lives in Shared and is
    /// unit-tested; <c>LocalizedImage</c> and the sprite/texture patches are its consumers.
    /// </summary>
    public static class RuImageName
    {
        /// <summary>A trailing language token: <c>&lt;base&gt;_ru</c> or <c>&lt;base&gt;_ru_&lt;state&gt;</c>.
        /// Anchored to the end so a stray "ru" inside a name (e.g. "ruin") is never matched.</summary>
        private static readonly Regex RuToken = new Regex(@"_ru(?=(_\d+)?$)");

        /// <summary>True if <paramref name="name"/> carries a trailing <c>_ru</c> language token.</summary>
        public static bool HasRuToken(string? name) =>
            name != null
            && name.IndexOf("_ru", StringComparison.Ordinal) >= 0 // cheap pre-check before the regex
            && RuToken.IsMatch(name);

        public static string ToEn(string ruName) => RuToken.Replace(ruName, "_en");
        public static string ToCn(string ruName) => RuToken.Replace(ruName, "_cn");
    }
}
