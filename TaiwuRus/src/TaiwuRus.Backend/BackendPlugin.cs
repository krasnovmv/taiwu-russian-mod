using System;
using System.IO;
using GameData.Utilities;
using HarmonyLib;
using TaiwuModdingLib.Core.Plugin;
using TaiwuRus.Shared;

namespace TaiwuRus.Backend
{
    /// <summary>
    /// Backend (.NET 8) entry point. Runs in the GameData process, so it may
    /// only touch backend types (GameData.Domains.*). Unpacks the Localization
    /// overlay (so the event files exist before this process reads them) and
    /// patches events/encyclopedia. Registered via Config.Lua -> BackendPlugins
    /// as TaiwuRusB.dll.
    /// </summary>
    [PluginConfig("TaiwuRusBackend", ModInfo.Author, ModInfo.Version)]
    [System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable",
        Justification = "Plugin lifetime is owned by the game's mod loader, which calls Dispose(); _harmony is unpatched there.")]
    public sealed class BackendPlugin : TaiwuRemakePlugin
    {
        private Harmony? _harmony;

        public override void Initialize()
        {
            UnpackOverlay();
            _harmony = new Harmony("com.krasnovmv.taiwurus.backend");
            _harmony.PatchAll(typeof(BackendPlugin).Assembly);
            AdaptableLog.Info("[TaiwuRus] backend plugin loaded");
        }

        // The backend runs as <game>/Backend/GameData.exe — a SEPARATE process from the Unity
        // frontend, with no ordering guarantee between the two plugins. Event/quest text loads
        // here via EventPackage.InitLanguage, which reads the RU files straight off disk. If only
        // the frontend unpacked them, this process could read before that copy lands (first
        // launch -> English fallback). So the backend unpacks the overlay too, before its patches.
        // OverlayDeployer.Copy is copy-if-newer and idempotent, so both processes doing it is safe.
        private static void UnpackOverlay()
        {
            // AppContext.BaseDirectory is <game>/Backend/; the game root is its parent.
            string? backendDir = AppContext.BaseDirectory?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string? gameRoot = string.IsNullOrEmpty(backendDir) ? null : Directory.GetParent(backendDir)?.FullName;
            string? modRoot = OverlayDeployer.FindModRoot(typeof(BackendPlugin).Assembly.Location, gameRoot);
            if (modRoot == null || gameRoot == null)
            {
                AdaptableLog.Info("[TaiwuRus] overlay: mod root or game root not found; skipping unpack");
                return;
            }
            OverlayDeployer.Copy(Path.Combine(modRoot, "Localization"), gameRoot, AdaptableLog.Info);
        }

        public override void OnModSettingUpdate()
        {
            // DomainManager.Mod.GetSetting(ModIdStr, "key", ref field) once settings exist.
        }

        public override void Dispose()
        {
            _harmony?.UnpatchSelf();
            AdaptableLog.Info("[TaiwuRus] backend plugin disposed");
        }
    }
}
