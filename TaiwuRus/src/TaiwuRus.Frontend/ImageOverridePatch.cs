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
    /// <c>GlobalSettings.Language</c> (i.e. "ru") and, if that sprite is missing, falls back to
    /// <c>"cn"</c> — never to English. So under RU these show Chinese, or a blank when there is no CN
    /// variant either. There is no `_ru` sprite in the atlases.
    ///
    /// When RU is selected and we ship a replacement PNG at
    /// <c>Language_RU/Images/&lt;base&gt;_ru.png</c> (resolved via <see cref="ModAssets"/> — the mod's
    /// own overlay first, then the game's StreamingAssets), load it as a standalone sprite and assign
    /// it directly (bypassing the atlas). When there is no RU PNG, force the English atlas sprite
    /// (falling back to Chinese only if there is no English variant), so the RU pack's fallback is
    /// English everywhere rather than Chinese or blank.
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
            if (sprite != null)
            {
                ___targetImage.sprite = sprite;
                ___targetImage.enabled = true;
                if (___nativeSize)
                    ___targetImage.SetNativeSize();
                if (Diag.Add(___imagePattern))
                    Debug.Log($"[TaiwuRus][img] pattern='{___imagePattern}' applied=RU-PNG");
                return;
            }

            // No RU PNG: the engine left a Chinese sprite (its "ru"→"cn" fallback) or a blank. Force
            // the English atlas sprite; if there is no English variant, restore the Chinese one.
            // SetSprite enables the image on success and disables it on a miss, so `enabled` tells us
            // whether English was found.
            string applied = "EN";
            ___targetImage.SetSprite(string.Format(___imagePattern, "en"), ___nativeSize);
            if (!___targetImage.enabled)
            {
                ___targetImage.SetSprite(string.Format(___imagePattern, "cn"), ___nativeSize);
                applied = ___targetImage.enabled ? "CN" : "NONE(blank)";
            }
            if (Diag.Add(___imagePattern))
                Debug.Log($"[TaiwuRus][img] pattern='{___imagePattern}' ru-png=false applied={applied}");
        }

        private static Sprite Load(string ruName)
        {
            if (Cache.TryGetValue(ruName, out Sprite cached))
                return cached;

            string file = ModAssets.Resolve("Language_RU", "Images", ruName + ".png");
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
