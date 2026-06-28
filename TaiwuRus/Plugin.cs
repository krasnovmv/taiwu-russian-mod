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
/// </summary>
[PluginConfig("TaiwuRus", "KrasnoVMV", "0.1.0")]
public class TaiwuRusFrontendPlugin : TaiwuRemakeHarmonyPlugin
{
    public override void Initialize()
    {
        // Base applies every [HarmonyPatch] class in this assembly.
        base.Initialize();
        Debug.Log("[TaiwuRus] frontend plugin loaded");
    }

    public override void OnModSettingUpdate()
    {
        base.OnModSettingUpdate();
        // Read ModManager.GetSetting(ModIdStr, "key", ref field) here once settings exist.
    }

    public override void Dispose()
    {
        Debug.Log("[TaiwuRus] frontend plugin disposed");
        base.Dispose();
    }
}
