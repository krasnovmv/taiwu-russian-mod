using GameData.Utilities;
using HarmonyLib;
using TaiwuModdingLib.Core.Plugin;
using TaiwuRus.Shared;

namespace TaiwuRus.Backend
{
    /// <summary>
    /// Backend (.NET 8) entry point. Runs in the GameData process, so it may
    /// only touch backend types (GameData.Domains.*). This is where Language_RU
    /// files get copied into the game tree and events/encyclopedia get patched.
    /// Registered via Config.Lua -> BackendPlugins as TaiwuRusB.dll.
    /// </summary>
    [PluginConfig("TaiwuRusBackend", ModInfo.Author, ModInfo.Version)]
    public sealed class BackendPlugin : TaiwuRemakePlugin
    {
        private Harmony _harmony;

        public override void Initialize()
        {
            _harmony = new Harmony("com.krasnovmv.taiwurus.backend");
            _harmony.PatchAll(typeof(BackendPlugin).Assembly);
            AdaptableLog.Info("[TaiwuRus] backend plugin loaded");
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
