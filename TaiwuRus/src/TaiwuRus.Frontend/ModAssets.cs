using System.Collections.Generic;
using System.IO;
using System.Reflection;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Resolves a StreamingAssets-relative asset, preferring the mod's own
    /// <c>Localization/</c> overlay over the game's real <c>StreamingAssets</c>.
    ///
    /// Writing translated files into the game install is fragile — Steam wipes them on
    /// update/verify. Instead the mod ships them under
    /// <c>Mod/&lt;id&gt;/Localization/&lt;…_Data&gt;/StreamingAssets/…</c> (mirroring the game
    /// layout) and we redirect reads there. The overlay is discovered once by probing the
    /// loaded assembly's folder and every <c>&lt;game&gt;/Mod/*</c> directory for the marker
    /// subtree (the DLL may be loaded from a temp copy, so a single location isn't enough).
    ///
    /// Falls back to the real <c>StreamingAssets</c> when no overlay file is present, so an
    /// in-place install (or a not-yet-populated overlay) keeps working unchanged.
    /// </summary>
    internal static class ModAssets
    {
        private static bool _resolved;
        private static string _overlay; // <modRoot>/Localization/<…_Data>/StreamingAssets, or null

        /// <summary>
        /// Map StreamingAssets-relative <paramref name="segments"/> to an absolute file path:
        /// the overlay copy when it exists, otherwise the real StreamingAssets path (which the
        /// caller's own <c>File.Exists</c> check then handles).
        /// </summary>
        public static string Resolve(params string[] segments)
        {
            string rel = segments.Length == 1 ? segments[0] : Path.Combine(segments);
            string overlay = Overlay();
            if (overlay != null)
            {
                string candidate = Path.Combine(overlay, rel);
                if (File.Exists(candidate))
                    return candidate;
            }
            return Path.Combine(Application.streamingAssetsPath, rel);
        }

        private static string Overlay()
        {
            if (_resolved)
                return _overlay;
            _resolved = true;
            try
            {
                _overlay = Discover();
            }
            catch
            {
                _overlay = null;
            }
            Debug.Log(_overlay != null
                ? $"[TaiwuRus] asset overlay: {_overlay}"
                : "[TaiwuRus] no asset overlay found; using game StreamingAssets");
            return _overlay;
        }

        private static string Discover()
        {
            // The data folder name ("The Scroll of Taiwu_Data") and game root, derived at runtime.
            string dataFolder = new DirectoryInfo(Application.dataPath).Name;
            string gameRoot = Directory.GetParent(Application.dataPath)?.FullName;

            foreach (string root in CandidateModRoots(gameRoot))
            {
                string overlay = Path.Combine(root, "Localization", dataFolder, "StreamingAssets");
                if (Directory.Exists(overlay))
                    return overlay;
            }
            return null;
        }

        private static IEnumerable<string> CandidateModRoots(string gameRoot)
        {
            // 1) The folder this assembly actually loaded from, and a few parents — covers the
            //    in-place install (Mod/<id>/Plugins/TaiwuRusF.dll -> Mod/<id>).
            string location = null;
            try { location = Assembly.GetExecutingAssembly().Location; }
            catch { /* dynamic/temp assembly with no location */ }
            if (!string.IsNullOrEmpty(location))
            {
                DirectoryInfo dir = Directory.GetParent(location);
                for (int i = 0; i < 4 && dir != null; i++, dir = dir.Parent)
                    yield return dir.FullName;
            }

            // 2) Every installed mod folder — covers a DLL loaded from a temp copy, where the
            //    mod's files still live under <game>/Mod/<id>.
            if (!string.IsNullOrEmpty(gameRoot))
            {
                string mods = Path.Combine(gameRoot, "Mod");
                if (Directory.Exists(mods))
                    foreach (string sub in Directory.GetDirectories(mods))
                        yield return sub;
            }
        }
    }
}
