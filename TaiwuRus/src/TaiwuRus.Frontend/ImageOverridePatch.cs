using System.Collections.Generic;
using System.IO;
using FrameWork.UI.LanguageRule;
using HarmonyLib;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Localized UI graphics (buttons/titles with baked-in text) are atlas sprites named
    /// <c>&lt;base&gt;_&lt;lang&gt;</c>. <see cref="LanguageRuleImagePattern"/> formats its pattern with
    /// <c>CurLanguageType</c> (EN for RU) — so Russian shows the English image. There is no `_ru`
    /// sprite in the atlases.
    ///
    /// When RU is selected and we ship a replacement PNG at
    /// <c>StreamingAssets/Language_RU/Images/&lt;base&gt;_ru.png</c>, load it as a standalone sprite and
    /// assign it directly (bypassing the atlas). Missing file → keep the engine's EN fallback.
    ///
    /// Target typed via publicizer nameof (RefreshImage is private); private fields are read via
    /// Harmony `___field` injection (net48-safe).
    /// </summary>
    [HarmonyPatch(typeof(LanguageRuleImagePattern), nameof(LanguageRuleImagePattern.RefreshImage))]
    internal static class ImageOverridePatch
    {
        private static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();
        private static readonly HashSet<string> Diag = new HashSet<string>();

        private static void Postfix(CImage ___targetImage, string ___imagePattern, bool ___nativeSize)
        {
            if (LocalStringManager.CurLanguageKey != "RU")
                return;
            if (___targetImage == null || string.IsNullOrEmpty(___imagePattern))
                return;

            string ruName = string.Format(___imagePattern, "ru"); // <base>_ru
            Sprite sprite = Load(ruName);
            if (Diag.Add(___imagePattern))
                Debug.Log($"[TaiwuRus][img] pattern='{___imagePattern}' ru='{ruName}' file={(sprite != null)}");
            if (sprite == null)
                return; // no RU image — leave the EN fallback the engine set

            ___targetImage.sprite = sprite;
            ___targetImage.enabled = true;
            if (___nativeSize)
                ___targetImage.SetNativeSize();
        }

        private static Sprite Load(string ruName)
        {
            if (Cache.TryGetValue(ruName, out Sprite cached))
                return cached;

            string file = Path.Combine(Application.streamingAssetsPath, "Language_RU", "Images", ruName + ".png");
            Sprite sprite = null;
            if (File.Exists(file))
            {
                var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (ImageConversion.LoadImage(tex, File.ReadAllBytes(file)))
                {
                    tex.name = ruName;
                    sprite = Sprite.Create(tex, new Rect(0f, 0f, tex.width, tex.height), new Vector2(0.5f, 0.5f), 100f);
                    sprite.name = ruName;
                }
            }
            Cache[ruName] = sprite; // cache null too, so we probe disk once per name
            return sprite;
        }
    }
}
