using System.IO;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Event-option condition hints load
    /// "RemakeResources/Data/Language_EventOptionTips/EventOptionTips_" + <c>CurLanguageKey</c>
    /// from an asset bundle. The engine's own error handler falls back to the CHINESE asset
    /// (<c>EventOptionTips_CN</c>). For "RU" the RU bundle asset doesn't exist.
    ///
    /// When we ship <c>StreamingAssets/EventLanguages_RU/EventOptionTips_RU.txt</c>, load that. When
    /// it is absent, load the ENGLISH bundle asset (<c>EventOptionTips_EN</c>) instead of letting the
    /// engine fall back to Chinese — so the RU pack's fallback is English everywhere (only if even EN
    /// is unavailable do we let the engine's Chinese load run, as a last resort).
    ///
    /// Target typed via publicizer nameof (the method is private). The private string[] field is set
    /// via reflection (<see cref="AccessTools.Field"/>) — net48-safe, unlike publicized direct field
    /// access which throws at runtime.
    /// </summary>
    [HarmonyPatch(typeof(EventModel), nameof(EventModel.LoadEventOptionTipsLanguageFile))]
    internal static class EventOptionTipsPatch
    {
        private const string BundleDir = "RemakeResources/Data/Language_EventOptionTips";
        private static FieldInfo _contentsField;

        private static bool Prefix(EventModel __instance)
        {
            if (LocalStringManager.CurLanguageKey != "RU")
                return true;

            _contentsField ??= AccessTools.Field(typeof(EventModel), "_optionAvailableContents");
            if (_contentsField == null)
                return true; // can't set the field — let the engine run (CN), better than crashing

            string file = ModAssets.Resolve("EventLanguages_RU", "EventOptionTips_RU.txt");
            if (File.Exists(file))
            {
                SetContents(__instance, File.ReadAllText(file));
                return false;
            }

            // No shipped RU file → load the English bundle asset, not the engine's Chinese fallback.
            // If EN itself is unavailable, fall back to Chinese as a last resort (the engine's own path).
            // Bundle asset paths always use '/', never Path.Combine ('\' on Windows breaks the lookup).
            ResLoader.Load<TextAsset>(
                BundleDir + "/EventOptionTips_EN",
                asset => SetContents(__instance, asset.text),
                _ => ResLoader.Load<TextAsset>(
                    BundleDir + "/EventOptionTips_CN",
                    asset => SetContents(__instance, asset.text)));
            return false;
        }

        private static void SetContents(EventModel instance, string text)
        {
            _contentsField.SetValue(instance, text.Replace("\r", "").Split('\n'));
        }
    }
}
