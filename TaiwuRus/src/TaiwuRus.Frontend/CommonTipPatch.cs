using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using Game.Views.MouseTips;
using HarmonyLib;
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
        private static readonly Dictionary<string, object> Cache = new Dictionary<string, object>();
        private static FieldInfo _pathField;
        private static Type _configType;

        private static bool Prefix(object configLine, ref object __result)
        {
            if (LocalStringManager.CurLanguageKey != "RU" || configLine == null)
                return true;

            _pathField ??= AccessTools.Field(configLine.GetType(), "Path");
            string path = _pathField?.GetValue(configLine) as string;
            if (string.IsNullOrEmpty(path))
                return true;

            if (Cache.TryGetValue(path, out object cached))
            {
                __result = cached;
                return false;
            }

            string file = ModAssets.Resolve("Language_RU", "CommonTip", path + ".json");
            if (!File.Exists(file))
                return true; // no RU file — let the engine load the EN one

            _configType ??= AccessTools.TypeByName("Game.Views.MouseTips.CommonTipConfig");
            if (_configType == null)
                return true;

            try
            {
                string json = Regex.Replace(File.ReadAllText(file), "^\\s*//.*$", "", RegexOptions.Multiline);
                object cfg = JsonConvert.DeserializeObject(json, _configType);
                Cache[path] = cfg;
                __result = cfg;
                return false;
            }
            catch
            {
                return true;
            }
        }
    }
}
