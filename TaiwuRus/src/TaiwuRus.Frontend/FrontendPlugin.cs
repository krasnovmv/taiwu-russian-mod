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
    [System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable",
        Justification = "Plugin lifetime is owned by the game's mod loader, which calls Dispose(); _harmony is unpatched there.")]
    public sealed class FrontendPlugin : TaiwuRemakePlugin
    {
        private Harmony? _harmony;

        public override void Initialize()
        {
            UnpackOverlay();
            RefreshImageSetting();
            _harmony = new Harmony("com.krasnovmv.taiwurus.frontend");
            _harmony.PatchAll(typeof(FrontendPlugin).Assembly);
            SortingFix.Apply();
            Debug.Log("[TaiwuRus] frontend plugin loaded");
        }

        // Read the "useImages" toggle (Config.Lua -> DefaultSettings) into the image-patch gate. The
        // patches read LocalizedImage.Active on every call, so this only needs to keep the flag current.
        // GetSetting leaves the value untouched when the mod/key isn't found, so the local default
        // (false — images off unless opted in) survives a missing setting.
        private void RefreshImageSetting()
        {
            bool useImages = false;
            ModManager.GetSetting(ModIdStr, "useImages", ref useImages);
            RuLocale.UseImages = useImages;
            Debug.Log($"[TaiwuRus] useImages = {useImages}");
        }

        // Copy the mod's Localization/ overlay into the real game tree (Language_RU, event packs,
        // …) before anything reads it. Files ship only inside the mod, so a Steam update/verify
        // can't clobber them; this self-heals on the next launch. The backend unpacks the same
        // overlay in its own process (see BackendPlugin) — this copy covers the frontend readers.
        private static void UnpackOverlay()
        {
            string? gameRoot = Directory.GetParent(Application.dataPath)?.FullName;
            string? modRoot = OverlayDeployer.FindModRoot(typeof(FrontendPlugin).Assembly.Location, gameRoot);
            if (modRoot == null || gameRoot == null)
            {
                Debug.Log("[TaiwuRus] overlay: mod root or game root not found; skipping unpack");
                return;
            }
            OverlayDeployer.Copy(Path.Combine(modRoot, "Localization"), gameRoot, Debug.Log);

            // First launch: the engine read the UI language pack at boot — before the copy above
            // landed — so it fell back to English. Now that Language_RU is on disk, rebuild the
            // string cache so the current session shows Russian without a restart.
            //
            // Gate on the active language + the pack existing on disk, NOT on this process's own
            // copy count: the backend unpacks the same overlay concurrently (see BackendPlugin), so
            // it may win the race and place Language_RU first, leaving our Copy() returning 0. The
            // Copy() above is synchronous, so once it returns the pack is guaranteed present (placed
            // here or already there) — reload unconditionally. Init() re-reads the folder from disk;
            // it's idempotent, so the redundant reload on later launches is a cheap no-op.
            if (RuLocale.IsRu
                && Directory.Exists(Path.Combine(Application.dataPath, "StreamingAssets", "Language_RU")))
            {
                try
                {
                    LocalStringManager.Init(LocalStringManager.CurLanguageKey);
                    Debug.Log("[TaiwuRus] reloaded UI language pack after overlay unpack");
                }
                catch (System.Exception e)
                {
                    Debug.Log("[TaiwuRus] UI language reload failed: " + e.Message);
                }
            }
        }

        public override void OnModSettingUpdate()
        {
            // NeedRestartWhenSettingChanged = true (Config.Lua) means the game restarts on change, so
            // this mostly runs at boot — but refresh anyway so the gate is never stale.
            RefreshImageSetting();
        }

        public override void Dispose()
        {
            _harmony?.UnpatchSelf();
            Debug.Log("[TaiwuRus] frontend plugin disposed");
        }
    }
}
