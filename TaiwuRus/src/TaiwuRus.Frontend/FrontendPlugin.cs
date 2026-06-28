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
            _harmony = new Harmony("com.krasnovmv.taiwurus.frontend");
            _harmony.PatchAll(typeof(FrontendPlugin).Assembly);
            SortingFix.Apply();
            Debug.Log("[TaiwuRus] frontend plugin loaded");
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
