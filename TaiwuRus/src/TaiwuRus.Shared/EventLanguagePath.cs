using System;

namespace TaiwuRus.Shared
{
    /// <summary>
    /// Rewrites an event language-pack path to its RU sibling. Pure string logic so it lives in
    /// Shared and is unit-tested; <c>EventLanguagePatch</c> is its consumer.
    /// </summary>
    public static class EventLanguagePath
    {
        private const string RuSuffix = "_Language_RU.txt";

        /// <summary>The suffixes the engine can hand us under Russian; see <c>EventLanguagePatch</c>.</summary>
        private static readonly string[] SourceSuffixes = { "_Language_EN.txt", "_Language_CN.txt" };

        /// <summary>The RU sibling of <paramref name="path"/>, or null if it is not an EN/CN pack path.</summary>
        public static string? ToRu(string? path)
        {
            if (string.IsNullOrEmpty(path))
                return null;
            foreach (string suffix in SourceSuffixes)
            {
                if (path!.EndsWith(suffix, StringComparison.Ordinal))
                    return path.Remove(path.Length - suffix.Length) + RuSuffix;
            }
            return null;
        }
    }
}
