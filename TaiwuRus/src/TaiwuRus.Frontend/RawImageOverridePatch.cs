using System.Collections.Generic;
using System.IO;
using FrameWork.UI.LanguageRule;
using HarmonyLib;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Most localized UI graphics are raw <c>Texture2D</c> shown through
    /// <see cref="LanguageRuleRawImagePattern"/> (CRawImage), named
    /// <c>&lt;…&gt;_&lt;lang&gt;_&lt;…&gt;</c>. RefreshImage formats the pattern with <c>CurLanguageType</c>
    /// (EN for RU), so Russian shows the English texture; there is no `_ru` texture.
    ///
    /// When RU is selected and we ship <c>Language_RU/Images/&lt;name&gt;.png</c> (where name =
    /// pattern formatted with "ru"; resolved via <see cref="ModAssets"/> — the mod's own overlay
    /// first, then the game's StreamingAssets), load it and assign the RawImage texture directly.
    /// Missing file → keep the engine's EN fallback.
    /// </summary>
    [HarmonyPatch(typeof(LanguageRuleRawImagePattern), nameof(LanguageRuleRawImagePattern.RefreshImage))]
    internal static class RawImageOverridePatch
    {
        private static readonly Dictionary<string, Texture2D> Cache = new Dictionary<string, Texture2D>();
        private static readonly HashSet<string> Diag = new HashSet<string>();

        private static void Postfix(CRawImage ___targetImage, string ___imagePattern)
        {
            if (LocalStringManager.CurLanguageKey != "RU")
                return;
            if (___targetImage == null || string.IsNullOrEmpty(___imagePattern))
                return;

            string ruName = string.Format(___imagePattern, "ru");
            Texture2D tex = Load(ruName);
            if (Diag.Add(___imagePattern))
                Debug.Log($"[TaiwuRus][rawimg] pattern='{___imagePattern}' ru='{ruName}' file={(tex != null)}");
            if (tex == null)
                return;

            ___targetImage.texture = tex;
            ___targetImage.enabled = true;
        }

        private static Texture2D Load(string ruName)
        {
            if (Cache.TryGetValue(ruName, out Texture2D cached))
                return cached;

            string file = ModAssets.Resolve("Language_RU", "Images", ruName + ".png");
            Texture2D tex = null;
            if (File.Exists(file))
            {
                var t = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (ImageConversion.LoadImage(t, File.ReadAllBytes(file)))
                {
                    t.name = ruName;
                    tex = t;
                }
            }
            Cache[ruName] = tex; // cache null too, so we probe disk once per name
            return tex;
        }
    }
}
