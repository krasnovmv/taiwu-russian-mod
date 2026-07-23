using System;
using System.Collections;
using System.Text;
using FrameWork;
using HarmonyLib;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// <c>Utils_Sorting.CompareByCurrentLangEncoding</c> indexes a private dictionary
    /// <c>LanguageEncodingDict[CurLanguageKey]</c> directly. "RU" is not one of its keys
    /// {CN,CNH,EN,JP,KO}, so any list sorted by the current language throws
    /// KeyNotFoundException once Russian is selected. Register RU -> Unicode so Cyrillic sorts by
    /// codepoint (EN's ASCII encoding would collapse every Cyrillic char to '?').
    ///
    /// One-time mutation (not a Harmony patch). The dictionary is a private static field, accessed
    /// via reflection — publicized direct field access throws at runtime on net48.
    /// </summary>
    internal static class SortingFix
    {
        public static void Apply()
        {
            try
            {
                var field = AccessTools.Field(typeof(Utils_Sorting), "LanguageEncodingDict");
                if (field?.GetValue(null) is IDictionary dict)
                {
                    if (!dict.Contains("RU"))
                    {
                        dict["RU"] = Encoding.Unicode;
                        Debug.Log("[TaiwuRus] sorting: registered RU encoding");
                    }
                }
                else
                {
                    // Name-based reflection the build can't check: without this line the
                    // symptom is a KeyNotFoundException deep inside list sorting with
                    // nothing in the log pointing at the mod.
                    Debug.LogWarning(
                        "[TaiwuRus] BREAKAGE: Utils_Sorting.LanguageEncodingDict is gone (game update?) — sorting any list by language will throw under RU");
                }
            }
            catch (Exception e)
            {
                // Full exception, not e.Message: the log is this mod's only diagnosis
                // channel, and the stack is what locates a reflection failure.
                Debug.LogWarning("[TaiwuRus] SortingFix failed: " + e);
            }
        }
    }
}
