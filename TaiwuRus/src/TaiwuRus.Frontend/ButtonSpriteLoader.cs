using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// Shared loader for CharacterMenu button icon states under RU. Both the tab buttons
    /// (<see cref="CharacterMenuButtonSpritePatch"/>) and the inscribe button
    /// (<see cref="InscribeButtonSpritePatch"/>) format the same per-state pattern
    /// <c>&lt;base&gt;_{0}_{1}</c> ({0}=language, {1}=state) and load it through <c>ResLoader</c>.
    /// Neither path goes through <see cref="FrameWork.UI.LanguageRule.LanguageRuleImagePattern"/>, so
    /// under RU we look for a shipped Russian PNG first and only fall back to the English atlas sprite.
    /// </summary>
    internal static class ButtonSpriteLoader
    {
        private static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();

        /// <summary>Load one state's sprite: the shipped RU PNG if present, else the EN atlas sprite.</summary>
        public static void LoadState(string pattern, int state, Action<Sprite> onLoaded)
        {
            Sprite ru = LoadRuPng(Path.GetFileName(string.Format(pattern, "ru", state)));
            if (ru != null)
            {
                onLoaded(ru);
                return;
            }
            ResLoader.Load<Sprite>(string.Format(pattern, "en", state), onLoaded);
        }

        // The pattern is a full resource path, so the RU override is keyed by its leaf name to keep
        // the flat Language_RU/Images/ layout the other image patches use.
        private static Sprite LoadRuPng(string ruName)
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
