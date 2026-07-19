namespace TaiwuRus.Shared
{
    /// <summary>
    /// THE two gates every patch in the pack checks — no raw "RU" string comparisons anywhere else.
    ///
    ///   • <see cref="IsRu"/>       — language only. Gates all TEXT replacements (events, tooltips,
    ///                                encyclopedia, name order, …) and the image patches' entry points.
    ///   • <see cref="UseRuImages"/> — language + the <c>useImages</c> mod setting. Gates the shipped
    ///                                RU PNG art step inside <c>LocalizedImage</c>.
    ///
    /// The image patches themselves stay on <see cref="IsRu"/> on purpose: with RU active the game
    /// asks for <c>_ru</c> sprites that exist in no atlas, so the EN→CN fallback must always run —
    /// otherwise icons render blank. The setting only decides whether the RU PNG override is tried
    /// first (see <c>LocalizedImage</c>).
    ///
    /// References only <c>LocalStringManager</c> (GameData.Shared, present in both processes), so this
    /// one source file links into the net48 frontend and the net8 backend alike. It is excluded from
    /// the standalone TaiwuRus.Shared build, which has no game references.
    /// </summary>
    internal static class RuLocale
    {
        public const string LanguageKey = "RU";

        /// <summary>Language-only gate: the mod's Russian language pack is active.</summary>
        public static bool IsRu => LocalStringManager.CurLanguageKey == LanguageKey;

        /// <summary>The <c>useImages</c> mod setting (Config.Lua), read by FrontendPlugin at startup
        /// and again on every settings change — the mod does not ask the game to restart, so this can
        /// flip mid-session (FrontendPlugin drops the RU PNG caches when it does).</summary>
        public static bool UseImages { get; set; }

        /// <summary>Image-art gate: RU is active AND the user opted into the shipped RU graphics.</summary>
        public static bool UseRuImages => IsRu && UseImages;
    }
}
