using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using FrameWork.UISystem.UIElements;
using TaiwuRus.Shared;
using UnityEngine;
using UnityEngine.UI;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// THE single definition of the RU image fallback policy. Every localized image and texture in the
    /// pack — whether set through FrameWork's LanguageRule components, by direct game code
    /// (<c>CImage.SetSprite</c> / <c>CRawImage.SetTexture</c>), or by an async <c>ResLoader</c> button
    /// loader — resolves through here, in ONE order:
    ///
    ///   1. shipped RU PNG override — <c>Language_RU/Images/&lt;ruName&gt;.png</c> (mod overlay, then StreamingAssets);
    ///      skipped when the <c>useImages</c> setting is off, so the waterfall starts at step 2
    ///   2. English variant         — the same name/path with its <c>_ru</c> language token rewritten to <c>_en</c>
    ///   3. Chinese variant         — … rewritten to <c>_cn</c> (the game's own default)
    ///
    /// The atlases ship no <c>_ru</c> sprites (RU graphics are PNG overrides), so redirecting a <c>_ru</c>
    /// token is always safe. This is the ONLY place that knows the order, the PNG location, or how a
    /// language token is rewritten — every patch is a thin adapter over the methods below.
    /// </summary>
    internal static class LocalizedImage
    {
        /// <summary>A trailing language token: <c>&lt;base&gt;_ru</c> or <c>&lt;base&gt;_ru_&lt;state&gt;</c>.
        /// Anchored to the end so a stray "ru" inside a name (e.g. "ruin") is never matched.</summary>
        private static readonly Regex RuToken = new Regex(@"_ru(?=(_\d+)?$)");

        private static readonly Dictionary<string, Sprite?> SpriteCache = new Dictionary<string, Sprite?>();
        private static readonly Dictionary<string, Texture2D?> TextureCache = new Dictionary<string, Texture2D?>();
        private static readonly HashSet<string> Diag = new HashSet<string>();

        /// <summary>True if <paramref name="name"/> carries a trailing <c>_ru</c> language token.</summary>
        public static bool HasRuToken(string name) =>
            !string.IsNullOrEmpty(name)
            && name.IndexOf("_ru", StringComparison.Ordinal) >= 0
            && RuToken.IsMatch(name);

        public static string ToEn(string ruName) => RuToken.Replace(ruName, "_en");
        public static string ToCn(string ruName) => RuToken.Replace(ruName, "_cn");

        // ── Step 1: the shipped RU PNG override, loaded once and cached (null cached too, so we probe
        //    disk only once per name). ────────────────────────────────────────────────────────────
        public static Sprite? RuSprite(string ruName)
        {
            if (SpriteCache.TryGetValue(ruName, out Sprite? cached))
                return cached;
            Texture2D? tex = LoadPng(ruName);
            Sprite? sprite = null;
            if (tex != null)
            {
                sprite = Sprite.Create(tex, new Rect(0f, 0f, tex.width, tex.height), new Vector2(0.5f, 0.5f), 100f);
                sprite.name = ruName;
            }
            SpriteCache[ruName] = sprite;
            return sprite;
        }

        public static Texture2D? RuTexture(string ruName)
        {
            if (TextureCache.TryGetValue(ruName, out Texture2D? cached))
                return cached;
            Texture2D? tex = LoadPng(ruName);
            TextureCache[ruName] = tex;
            return tex;
        }

        private static Texture2D? LoadPng(string ruName)
        {
            if (!RuLocale.UseRuImages)
                return null; // setting off → skip the RU PNG; the waterfall falls through to EN → CN
            string file = ModAssets.Resolve("Language_RU", "Images", ruName + ".png");
            if (!File.Exists(file))
                return null;
            var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!ImageConversion.LoadImage(tex, File.ReadAllBytes(file)))
            {
                // Unity native memory isn't garbage-collected; destroy the failed texture explicitly.
                UnityEngine.Object.Destroy(tex);
                return null;
            }
            tex.name = ruName;
            return tex;
        }

        // ── The full policy applied to a live image. Steps 2/3 go through the engine's own setter using
        //    the caller-supplied EN/CN name — which carries no "_ru" token, so re-entering the
        //    SetSprite/SetTexture patches is a harmless pass-through (no recursion). The three names are
        //    supplied by the caller because they may be derived two ways: a LanguageRule component knows
        //    the FORMAT PATTERN (so it formats `{0}` with "en"/"cn" — correct even when the language slot
        //    is not the last token), while a code-set call knows only the final NAME (so it rewrites the
        //    trailing "_ru" token). Only the order lives here; name derivation is the caller's concern. ──

        /// <summary>Apply the RU-localized sprite from a format pattern (LanguageRule entry point).</summary>
        public static void ApplySpriteFromPattern(CImage img, string pattern, bool nativeSize) =>
            ApplySprite(img,
                string.Format(CultureInfo.InvariantCulture, pattern, "ru"),
                string.Format(CultureInfo.InvariantCulture, pattern, "en"),
                string.Format(CultureInfo.InvariantCulture, pattern, "cn"), nativeSize);

        /// <summary>Apply the RU-localized sprite from a final <c>_ru</c> name (code-set entry point).</summary>
        public static void ApplySprite(CImage img, string ruName, bool nativeSize) =>
            ApplySprite(img, ruName, ToEn(ruName), ToCn(ruName), nativeSize);

        private static void ApplySprite(CImage img, string ruName, string enName, string cnName, bool nativeSize)
        {
            if (img == null || string.IsNullOrEmpty(ruName))
                return;

            Sprite? ru = RuSprite(ruName);
            if (ru != null)
            {
                img.sprite = ru;
                img.enabled = true;
                if (nativeSize)
                    img.SetNativeSize();
                LogApplied("sprite", ruName, "RU-PNG");
                return;
            }

            img.SetSprite(enName, nativeSize);
            if (!img.enabled)
                img.SetSprite(cnName, nativeSize);
            LogApplied("sprite", ruName, img.enabled ? "EN/CN" : "NONE");
        }

        /// <summary>Apply the RU-localized texture from a format pattern (LanguageRule entry point).</summary>
        public static bool ApplyTextureFromPattern(CRawImage img, string pattern) =>
            ApplyTexture(img,
                string.Format(CultureInfo.InvariantCulture, pattern, "ru"),
                string.Format(CultureInfo.InvariantCulture, pattern, "en"),
                string.Format(CultureInfo.InvariantCulture, pattern, "cn"));

        /// <summary>Apply the RU-localized texture from a final <c>_ru</c> name (code-set entry point).
        /// Returns whether a texture was set (mirrors <c>CRawImage.SetTexture</c>'s bool result).</summary>
        public static bool ApplyTexture(CRawImage img, string ruName) =>
            ApplyTexture(img, ruName, ToEn(ruName), ToCn(ruName));

        private static bool ApplyTexture(CRawImage img, string ruName, string enName, string cnName)
        {
            if (img == null || string.IsNullOrEmpty(ruName))
                return false;

            Texture2D? ru = RuTexture(ruName);
            if (ru != null)
            {
                img.texture = ru;
                img.enabled = true;
                LogApplied("texture", ruName, "RU-PNG");
                return true;
            }

            bool ok = img.SetTexture(enName) || img.SetTexture(cnName);
            if (ok)
                img.enabled = true;
            LogApplied("texture", ruName, ok ? "EN/CN" : "NONE");
            return ok;
        }

        /// <summary>Async loader path (button icon states): RU PNG → EN resource → CN resource.
        /// <paramref name="ruPath"/> is a resource path already carrying the <c>_ru</c> token;
        /// <paramref name="load"/> is the concrete loader to use (<c>ResLoader.Load</c> or
        /// <c>LoadModOrGameResource</c>), so callers keep their own path/loader conventions while the
        /// fallback order stays identical.</summary>
        public static void LoadSprite(string ruPath, Action<string, Action<Sprite?>> load, Action<Sprite?> onLoaded)
        {
            Sprite? ru = RuSprite(Path.GetFileName(ruPath));
            if (ru != null)
            {
                onLoaded(ru);
                return;
            }
            load(ToEn(ruPath), en =>
            {
                if (en != null)
                {
                    onLoaded(en);
                    return;
                }
                load(ToCn(ruPath), onLoaded);
            });
        }

        /// <summary>
        /// Button entry point: load a button's four interaction-state sprites from a
        /// <c>{0}</c>=language, <c>{1}</c>=state pattern, each through the RU PNG → EN → CN policy.
        /// State indices differ per call site (see the two button patches), so they are parameters.
        /// The interaction states are chained so the value-type <see cref="SpriteState"/> is fully
        /// populated before it is copied into the button.
        /// </summary>
        public static void ApplyButtonStates(CButton btn, string pattern, Action<string, Action<Sprite?>> load,
            int normal, int highlighted, int pressed, int disabled)
        {
            CImage btnImg = btn.GetComponent<CImage>();
            SpriteState spriteState = new SpriteState();

            void LoadState(int state, Action<Sprite?> onLoaded) =>
                LoadSprite(string.Format(CultureInfo.InvariantCulture, pattern, "ru", state), load, onLoaded);

            LoadState(normal, s =>
            {
                if (btnImg != null)
                    btnImg.sprite = s;
            });

            LoadState(highlighted, s1 =>
            {
                spriteState.highlightedSprite = s1;
                spriteState.selectedSprite = s1;
                LoadState(pressed, s2 =>
                {
                    spriteState.pressedSprite = s2;
                    LoadState(disabled, s3 =>
                    {
                        spriteState.disabledSprite = s3;
                        btn.spriteState = spriteState;
                    });
                });
            });
        }

        private static void LogApplied(string kind, string ruName, string applied)
        {
            if (Diag.Add(kind + ":" + ruName))
                Debug.Log($"[TaiwuRus][img] {kind} '{ruName}' applied={applied}");
        }
    }
}
