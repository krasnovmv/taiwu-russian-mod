using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using Game.Views.MouseTips;
using HarmonyLib;
using TaiwuRus.Shared;
using Newtonsoft.Json;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// CommonTip tooltips load from "Language_" + <c>CurLanguageType</c> + "/CommonTip" — i.e.
    /// Language_EN for RU. Serve them from Language_RU/CommonTip instead (fall back to EN when a
    /// file is missing).
    ///
    /// The patch TARGET is typed (<see cref="ToolTipCommon"/>.LoadConfig via publicizer nameof —
    /// a rename breaks the build). The BODY must use reflection: the config type
    /// <c>CommonTipConfig</c> is <c>internal sealed</c>, so on net48 it cannot be named in typed
    /// code (IgnoresAccessChecksTo is not honored), and the parameter is passed as <c>object</c>.
    /// </summary>
    [HarmonyPatch(typeof(ToolTipCommon), nameof(ToolTipCommon.LoadConfig))]
    internal static class CommonTipPatch
    {
        private static readonly Dictionary<string, object?> Cache = new Dictionary<string, object?>();
        private static readonly HashSet<string> Failed = new HashSet<string>();
        private static FieldInfo? _pathField;
        private static bool _pathFieldResolved;
        private static Type? _configType;
        private static bool _configTypeResolved;

        private static bool Prefix(object? configLine, ref object? __result)
        {
            if (!RuLocale.IsRu || configLine == null)
                return true;

            // Both lookups memoize their RESULT, success or failure: a plain ??= re-runs
            // the reflection scan on every tooltip open once the member is gone — a
            // hot-path cost paid exactly when the mod is broken — and the degradation
            // (English tooltips) would be undiagnosable from the log. The build can't
            // catch these renames (name-based reflection), so log each loudly once.
            if (!_pathFieldResolved)
            {
                _pathFieldResolved = true;
                _pathField = AccessTools.Field(configLine.GetType(), "Path");
                if (_pathField == null)
                    UnityEngine.Debug.LogWarning(
                        "[TaiwuRus] BREAKAGE: CommonTipConfig.Path is gone (game update?) — tooltips degrade to English");
            }
            string? path = _pathField?.GetValue(configLine) as string;
            if (path == null || path.Length == 0) // explicit: net48 BCL lacks the narrowing annotations
                return true;

            if (Cache.TryGetValue(path, out object? cached))
            {
                __result = cached;
                return false;
            }
            if (Failed.Contains(path))
                return true; // known-broken RU file — engine loads EN; already logged once

            string file = ModAssets.Resolve("Language_RU", "CommonTip", path + ".json");
            if (!File.Exists(file))
                return true; // no RU file — let the engine load the EN one

            if (!_configTypeResolved)
            {
                _configTypeResolved = true;
                _configType = AccessTools.TypeByName("Game.Views.MouseTips.CommonTipConfig");
                if (_configType == null)
                    UnityEngine.Debug.LogWarning(
                        "[TaiwuRus] BREAKAGE: type Game.Views.MouseTips.CommonTipConfig is gone (game update?) — tooltips degrade to English");
            }
            if (_configType == null)
                return true;

            try
            {
                string json = Regex.Replace(File.ReadAllText(file), "^\\s*//.*$", "", RegexOptions.Multiline);
                object? cfg = JsonConvert.DeserializeObject(json, _configType);
                Cache[path] = cfg;
                __result = cfg;
                return false;
            }
            catch (Exception e)
            {
                // A broken RU json would otherwise silently fall back to EN and be undiagnosable.
                // Log once per file, remember the failure so we don't re-read/re-parse every tooltip.
                Failed.Add(path);
                UnityEngine.Debug.LogWarning($"[TaiwuRus] CommonTip '{path}' RU json failed, using EN: {e.Message}");
                return true;
            }
        }
    }
}
