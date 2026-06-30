using System.IO;
using HarmonyLib;
using TaiwuModdingLib.Core.Plugin;
using TaiwuRus.Shared;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Frontend (Unity) entry point. Runs in the Unity/Mono process, so it may
    /// only touch frontend types (UnityEngine, FrameWork.*, Assembly-CSharp).
    /// Registered via Config.Lua -> FrontendPlugins as TaiwuRusF.dll.
    /// </summary>
    [PluginConfig("TaiwuRusFrontend", ModInfo.Author, ModInfo.Version)]
    public sealed class FrontendPlugin : TaiwuRemakePlugin
    {
        private Harmony _harmony;

        public override void Initialize()
        {
            UnpackOverlay();
            _harmony = new Harmony("com.krasnovmv.taiwurus.frontend");
            _harmony.PatchAll(typeof(FrontendPlugin).Assembly);
            SortingFix.Apply();
            Debug.Log("[TaiwuRus] frontend plugin loaded");
        }

        // Copy the mod's Localization/ overlay into the real game tree (Language_RU, event packs,
        // …) before anything reads it. Files ship only inside the mod, so a Steam update/verify
        // can't clobber them; this self-heals on the next launch. Covers both processes — the
        // backend reads the event files from the same on-disk locations.
        private static void UnpackOverlay()
        {
            string modRoot = OverlayDeployer.FindModRoot(typeof(FrontendPlugin).Assembly.Location);
            string gameRoot = Directory.GetParent(Application.dataPath)?.FullName;
            if (modRoot == null || gameRoot == null)
            {
                Debug.Log("[TaiwuRus] overlay: mod root or game root not found; skipping unpack");
                return;
            }
            OverlayDeployer.Copy(Path.Combine(modRoot, "Localization"), gameRoot, Debug.Log);
        }

        public override void OnModSettingUpdate()
        {
            // ModManager.GetSetting(ModIdStr, "key", ref field) once settings exist.
        }

        public override void Dispose()
        {
            _harmony?.UnpatchSelf();
            Debug.Log("[TaiwuRus] frontend plugin disposed");
        }
    }
}
