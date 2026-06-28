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
                if (field?.GetValue(null) is IDictionary dict && !dict.Contains("RU"))
                {
                    dict["RU"] = Encoding.Unicode;
                    Debug.Log("[TaiwuRus] sorting: registered RU encoding");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning("[TaiwuRus] SortingFix failed: " + e.Message);
            }
        }
    }
}
