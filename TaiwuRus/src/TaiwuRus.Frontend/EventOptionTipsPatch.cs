using System.IO;
using System.Reflection;
using HarmonyLib;
using TaiwuRus.Shared;
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
        private static FieldInfo? _contentsField;
        private static bool _contentsResolved;

        private static bool Prefix(EventModel __instance)
        {
            if (!RuLocale.IsRu)
                return true;

            // Memoize the lookup RESULT, success or failure: a plain ??= re-runs the
            // reflection scan on every call once the field is gone, and the degradation
            // (Chinese tips) would be undiagnosable from the log. The build can't catch
            // this rename — the field is read by name at runtime — so log it loudly once.
            if (!_contentsResolved)
            {
                _contentsResolved = true;
                _contentsField = AccessTools.Field(typeof(EventModel), "_optionAvailableContents");
                if (_contentsField == null)
                    UnityEngine.Debug.LogWarning(
                        "[TaiwuRus] BREAKAGE: EventModel._optionAvailableContents is gone (game update?) — event option tips degrade to the engine's Chinese fallback");
            }
            if (_contentsField is not FieldInfo contents)
                return true; // can't set the field — let the engine run (CN), better than crashing

            string file = ModAssets.Resolve("EventLanguages_RU", "EventOptionTips_RU.txt");
            if (File.Exists(file))
            {
                SetContents(contents, __instance, File.ReadAllText(file));
                return false;
            }

            // No shipped RU file → load the English bundle asset, not the engine's Chinese fallback.
            // If EN itself is unavailable, fall back to Chinese as a last resort (the engine's own path).
            // Bundle asset paths always use '/', never Path.Combine ('\' on Windows breaks the lookup).
            ResLoader.Load<TextAsset>(
                BundleDir + "/EventOptionTips_EN",
                asset => SetContents(contents, __instance, asset.text),
                _ =>
                {
                    UnityEngine.Debug.LogWarning("[TaiwuRus] EventOptionTips_EN not found; falling back to CN");
                    ResLoader.Load<TextAsset>(
                        BundleDir + "/EventOptionTips_CN",
                        asset => SetContents(contents, __instance, asset.text));
                });
            return false;
        }

        private static void SetContents(FieldInfo contents, EventModel instance, string text)
        {
            contents.SetValue(instance, text.Replace("\r", "").Split('\n'));
        }
    }
}
