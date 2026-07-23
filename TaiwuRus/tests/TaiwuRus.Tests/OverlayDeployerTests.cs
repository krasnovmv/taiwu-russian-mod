using System;
using System.IO;
using TaiwuRus.Shared;
using Xunit;

namespace TaiwuRus.Tests
{
    public sealed class OverlayDeployerTests : IDisposable
    {
        private readonly string _root;

        public OverlayDeployerTests()
        {
            _root = Path.Combine(Path.GetTempPath(), "TaiwuRusTests_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_root);
        }

        public void Dispose()
        {
            try { Directory.Delete(_root, recursive: true); } catch { /* best effort */ }
        }

        private string Dir(params string[] segments)
        {
            string path = Path.Combine(_root, Path.Combine(segments));
            Directory.CreateDirectory(path);
            return path;
        }

        private string WriteFile(string relative, string content)
        {
            string path = Path.Combine(_root, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
            return path;
        }

        // ── Copy ────────────────────────────────────────────────────────────────────────────

        [Fact]
        public void Copy_places_files_at_the_same_relative_path()
        {
            string overlay = Dir("overlay");
            string game = Dir("game");
            WriteFile(@"overlay\Data\StreamingAssets\Language_RU\ui.txt", "привет");

            int copied = OverlayDeployer.Copy(overlay, game);

            Assert.Equal(1, copied);
            Assert.Equal("привет", File.ReadAllText(Path.Combine(game, "Data", "StreamingAssets", "Language_RU", "ui.txt")));
        }

        [Fact]
        public void Copy_skips_up_to_date_destinations()
        {
            string overlay = Dir("overlay");
            string game = Dir("game");
            WriteFile(@"overlay\a.txt", "v1");

            Assert.Equal(1, OverlayDeployer.Copy(overlay, game));
            Assert.Equal(0, OverlayDeployer.Copy(overlay, game)); // second run: nothing stale
        }

        [Fact]
        public void Copy_overwrites_when_source_is_newer()
        {
            string overlay = Dir("overlay");
            string game = Dir("game");
            string src = WriteFile(@"overlay\a.txt", "v1");
            OverlayDeployer.Copy(overlay, game);

            File.WriteAllText(src, "v2");
            File.SetLastWriteTimeUtc(src, DateTime.UtcNow.AddMinutes(1)); // clearly newer than the copy

            Assert.Equal(1, OverlayDeployer.Copy(overlay, game));
            Assert.Equal("v2", File.ReadAllText(Path.Combine(game, "a.txt")));
        }

        [Fact]
        public void Copy_leaves_newer_destinations_alone()
        {
            string overlay = Dir("overlay");
            string game = Dir("game");
            string src = WriteFile(@"overlay\a.txt", "old");
            string dst = WriteFile(@"game\a.txt", "newer");
            File.SetLastWriteTimeUtc(dst, File.GetLastWriteTimeUtc(src).AddMinutes(1));

            Assert.Equal(0, OverlayDeployer.Copy(overlay, game));
            Assert.Equal("newer", File.ReadAllText(dst));
        }

        [Fact]
        public void Copy_leaves_no_temp_files_behind()
        {
            string overlay = Dir("overlay");
            string game = Dir("game");
            WriteFile(@"overlay\Data\a.txt", "v1");
            WriteFile(@"game\Data\a.txt", "old"); // overwrite path goes through the temp file too

            OverlayDeployer.Copy(overlay, game);

            Assert.Empty(Directory.GetFiles(game, "*.taiwurus-tmp", SearchOption.AllDirectories));
        }

        [Fact]
        public void Copy_consumes_an_orphaned_temp_file_from_a_crashed_run()
        {
            // A crash between the temp copy and the rename leaves dst stale and the temp behind;
            // the next run must overwrite the orphan and complete the swap.
            string overlay = Dir("overlay");
            string game = Dir("game");
            WriteFile(@"overlay\a.txt", "complete");
            WriteFile(@"game\a.txt.taiwurus-tmp", "trunca");

            Assert.Equal(1, OverlayDeployer.Copy(overlay, game));
            Assert.Equal("complete", File.ReadAllText(Path.Combine(game, "a.txt")));
            Assert.False(File.Exists(Path.Combine(game, "a.txt.taiwurus-tmp")));
        }

        [Theory]
        [InlineData(null, "game")]
        [InlineData("overlay", null)]
        [InlineData("", "game")]
        [InlineData("missing-dir", "game")]
        public void Copy_returns_zero_for_absent_inputs(string? overlay, string? game)
        {
            string? overlayPath = overlay == null ? null : Path.Combine(_root, overlay);
            string? gamePath = game == null ? null : Dir(game);

            Assert.Equal(0, OverlayDeployer.Copy(overlayPath, gamePath));
        }

        // ── FindModRoot ─────────────────────────────────────────────────────────────────────

        [Fact]
        public void FindModRoot_walks_up_from_the_plugin_dll()
        {
            Dir("game", "Mod", "TaiwuRus", "Localization", "Taiwu_Data", "StreamingAssets");
            string dll = Path.Combine(_root, "game", "Mod", "TaiwuRus", "Plugins", "TaiwuRusF.dll");

            Assert.Equal(
                Path.Combine(_root, "game", "Mod", "TaiwuRus"),
                OverlayDeployer.FindModRoot(dll, gameRoot: null));
        }

        [Fact]
        public void FindModRoot_scans_the_mod_folder_when_the_dll_location_is_useless()
        {
            Dir("game", "Mod", "SomeOtherMod");
            Dir("game", "Mod", "TaiwuRus", "Localization", "Taiwu_Data", "StreamingAssets");

            Assert.Equal(
                Path.Combine(_root, "game", "Mod", "TaiwuRus"),
                OverlayDeployer.FindModRoot(assemblyLocation: null, Path.Combine(_root, "game")));
        }

        [Fact]
        public void FindModRoot_returns_null_when_no_marker_exists()
        {
            Dir("game", "Mod", "TaiwuRus"); // no Localization/ inside

            Assert.Null(OverlayDeployer.FindModRoot(null, Path.Combine(_root, "game")));
        }

        [Fact]
        public void FindModRoot_ignores_a_bare_Localization_folder_without_the_overlay_subtree()
        {
            // A Localization/ folder alone (no <…_Data>/StreamingAssets) is not our overlay —
            // e.g. some unrelated mod that ships a folder by that name.
            Dir("game", "Mod", "TaiwuRus", "Localization");

            Assert.Null(OverlayDeployer.FindModRoot(null, Path.Combine(_root, "game")));
        }

        [Fact]
        public void FindModRoot_finds_a_subscribed_workshop_mod_beside_the_install()
        {
            // Steam layout: the game under steamapps/common and the subscribed mod under
            // steamapps/workshop/content/<appid>/<id> — NOT under <game>/Mod (which is empty).
            string game = Dir("SteamLibrary", "steamapps", "common", "Taiwu");
            Dir("SteamLibrary", "steamapps", "common", "Taiwu", "Mod"); // present but empty
            string mod = Dir("SteamLibrary", "steamapps", "workshop", "content", "838350", "3757119125");
            Dir("SteamLibrary", "steamapps", "workshop", "content", "838350", "3757119125",
                "Localization", "Taiwu_Data", "StreamingAssets");

            Assert.Equal(mod, OverlayDeployer.FindModRoot(assemblyLocation: null, game));
        }

        [Fact]
        public void FindModRoot_ignores_a_foreign_workshop_mod_without_our_overlay()
        {
            string game = Dir("SteamLibrary", "steamapps", "common", "Taiwu");
            // A different subscribed item that ships no localization overlay.
            Dir("SteamLibrary", "steamapps", "workshop", "content", "838350", "9999999999", "Plugins");

            Assert.Null(OverlayDeployer.FindModRoot(assemblyLocation: null, game));
        }
    }
}
