using HarmonyLib;
using TaiwuModdingLib.Core.Plugin;
using UnityEngine;

namespace TaiwuRus;

/// <summary>
/// Frontend (Unity) entry point of the Russian localization loader.
/// Registered via Config.Lua -> FrontendPlugins. Runs inside the Unity/Mono
/// process, so it may only touch frontend types (UnityEngine, FrameWork.*,
/// Assembly-CSharp). Backend work (copying Language_RU files, patching events)
/// belongs in a separate backend plugin.
///
/// This TaiwuModdingLib version exposes only TaiwuRemakePlugin (no Harmony
/// subclass), so the Harmony instance is created and disposed by hand.
/// </summary>
[PluginConfig("TaiwuRus", "KrasnoVMV", "0.1.0")]
public class TaiwuRusFrontendPlugin : TaiwuRemakePlugin
{
    private Harmony? _harmony;

    public override void Initialize()
    {
        _harmony = new Harmony("com.krasnovmv.taiwurus.frontend");
        _harmony.PatchAll(typeof(TaiwuRusFrontendPlugin).Assembly);
        Debug.Log("[TaiwuRus] frontend plugin loaded");
    }

    public override void OnModSettingUpdate()
    {
        // Read ModManager.GetSetting(ModIdStr, "key", ref field) here once settings exist.
    }

    public override void Dispose()
    {
        _harmony?.UnpatchAll(_harmony.Id);
        Debug.Log("[TaiwuRus] frontend plugin disposed");
    }
}
