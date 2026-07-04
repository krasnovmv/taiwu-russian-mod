using System;
using System.Collections.Generic;
using System.IO;

namespace TaiwuRus.Shared
{
    /// <summary>
    /// Unpacks the mod's <c>Localization/</c> overlay into the real game tree at startup.
    ///
    /// Translated files ship ONLY inside the mod (<c>Mod/&lt;id&gt;/Localization/&lt;game-root
    /// layout&gt;</c>) — never written into the install by the build pipeline, so a Steam update or
    /// cache-verify can't clobber them. On launch the plugin copies them into place (copy only when
    /// missing or newer), so the engine loads them from their normal locations with no engine
    /// patches. Removed by a Steam verify → re-created on the next launch (self-healing).
    ///
    /// Pure BCL so the one source file links into both the net48 frontend and the net8 backend.
    /// </summary>
    public static class OverlayDeployer
    {
        /// <summary>
        /// Find the mod root — the directory that contains a <c>Localization</c> subfolder.
        /// First walks up from <paramref name="assemblyLocation"/> (the loaded plugin DLL); the
        /// Taiwu loader often loads plugins from a byte[] so <c>Assembly.Location</c> is empty, so
        /// it then scans every <c>&lt;gameRoot&gt;/Mod/*</c> folder for the marker. Returns null if
        /// none is found (e.g. a not-yet-populated overlay).
        /// </summary>
        public static string? FindModRoot(string? assemblyLocation, string? gameRoot)
        {
            foreach (string root in CandidateModRoots(assemblyLocation, gameRoot))
            {
                if (Directory.Exists(Path.Combine(root, "Localization")))
                    return root;
            }
            return null;
        }

        /// <summary>
        /// Every place this mod's files might live, in probe order: the loaded DLL's folder and a
        /// few parents (in-place install, Mod/&lt;id&gt;/Plugins/*.dll → Mod/&lt;id&gt;), then every
        /// <c>&lt;gameRoot&gt;/Mod/*</c> directory (the loader may run the DLL from a temp copy).
        /// The SINGLE enumeration behind every marker probe (<see cref="FindModRoot"/>, the
        /// frontend's asset-overlay discovery) so the search order can't drift apart.
        /// </summary>
        public static IEnumerable<string> CandidateModRoots(string? assemblyLocation, string? gameRoot)
        {
            if (assemblyLocation != null && assemblyLocation.Length != 0)
            {
                DirectoryInfo? dir = Directory.GetParent(assemblyLocation);
                for (int i = 0; i < 5 && dir != null; i++, dir = dir.Parent)
                    yield return dir.FullName;
            }

            if (gameRoot != null && gameRoot.Length != 0)
            {
                string mods = Path.Combine(gameRoot, "Mod");
                if (Directory.Exists(mods))
                {
                    foreach (string sub in Directory.GetDirectories(mods))
                        yield return sub;
                }
            }
        }

        /// <summary>
        /// Copy every file under <paramref name="overlayRoot"/> into <paramref name="gameRoot"/> at
        /// the same relative path, creating directories as needed. A file is copied only when the
        /// destination is missing or older than the source. Returns the number of files copied.
        /// </summary>
        public static int Copy(string? overlayRoot, string? gameRoot, Action<string>? log = null)
        {
            // Explicit null/empty checks (not string.IsNullOrEmpty): this file also compiles for
            // netstandard2.0/net48, whose BCL lacks the annotations the compiler needs to narrow.
            if (overlayRoot == null || overlayRoot.Length == 0 || !Directory.Exists(overlayRoot)
                || gameRoot == null || gameRoot.Length == 0)
                return 0;

            int copied = 0, scanned = 0;
            foreach (string src in Directory.EnumerateFiles(overlayRoot, "*", SearchOption.AllDirectories))
            {
                scanned++;
                string rel = src.Substring(overlayRoot.Length).TrimStart('/', '\\');
                string dst = Path.Combine(gameRoot, rel);
                try
                {
                    if (!IsStale(src, dst))
                        continue;
                    string? dstDir = Path.GetDirectoryName(dst);
                    if (!string.IsNullOrEmpty(dstDir))
                        Directory.CreateDirectory(dstDir);
                    File.Copy(src, dst, true);
                    copied++;
                }
                catch (Exception e)
                {
                    log?.Invoke($"[TaiwuRus] overlay copy failed: {rel} ({e.Message})");
                }
            }
            log?.Invoke($"[TaiwuRus] overlay: {copied} file(s) copied / {scanned} scanned -> {gameRoot}");
            return copied;
        }

        // Copy when the destination is absent or older than the source (so re-translation propagates
        // and a Steam-verify wipe is repaired, but unchanged files are left alone).
        private static bool IsStale(string src, string dst)
        {
            if (!File.Exists(dst))
                return true;
            return File.GetLastWriteTimeUtc(src) > File.GetLastWriteTimeUtc(dst);
        }
    }
}
