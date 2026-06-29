using System.IO;
using System.Reflection;
using HarmonyLib;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Event-option condition hints load
    /// "RemakeResources/Data/Language_EventOptionTips/EventOptionTips_" + <c>CurLanguageKey</c>
    /// from an asset bundle. For "RU" that asset doesn't exist, so the engine logs an error and
    /// falls back to the Chinese file. Load our RU file from StreamingAssets/EventLanguages_RU
    /// when present (skipping the failing bundle load and the CN fallback).
    ///
    /// Target typed via publicizer nameof (the method is private). The private string[] field is
    /// set via reflection (<see cref="AccessTools.Field"/>) — net48-safe, unlike publicized direct
    /// field access which throws at runtime.
    ///
    /// NOTE: a no-op until EventOptionTips_RU.txt exists. That source lives inside a RemakeResources
    /// bundle, so the translation toolchain doesn't currently produce it — it must be extracted,
    /// translated, and shipped before this takes effect.
    /// </summary>
    [HarmonyPatch(typeof(EventModel), nameof(EventModel.LoadEventOptionTipsLanguageFile))]
    internal static class EventOptionTipsPatch
    {
        private static FieldInfo _contentsField;

        private static bool Prefix(EventModel __instance)
        {
            if (LocalStringManager.CurLanguageKey != "RU")
                return true;

            string file = ModAssets.Resolve("EventLanguages_RU", "EventOptionTips_RU.txt");
            if (!File.Exists(file))
                return true; // no RU file yet — let the engine handle it

            _contentsField ??= AccessTools.Field(typeof(EventModel), "_optionAvailableContents");
            if (_contentsField == null)
                return true;

            _contentsField.SetValue(__instance, File.ReadAllText(file).Replace("\r", "").Split('\n'));
            return false;
        }
    }
}
