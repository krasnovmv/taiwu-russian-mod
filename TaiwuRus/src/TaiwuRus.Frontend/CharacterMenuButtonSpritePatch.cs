using System;
using FrameWork.UISystem.UIElements;
using Game.Views.CharacterMenu;
using HarmonyLib;
using TaiwuRus.Shared;
using UnityEngine;
using UnityEngine.UI;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// CharacterMenu tab buttons load their icon states straight through
    /// <c>ResLoader.Load&lt;Sprite&gt;</c>, formatting a per-tab pattern
    /// <c>RemakeResources/UIGraphics5.0/Ui9CharacterMenu/ui9_btn_&lt;tab&gt;_{0}_{1}</c> with
    /// {0}=UI language lowercased and {1}=state index. This path does NOT go through
    /// <c>LanguageRuleImagePattern</c>, so it never maps RU→EN: under RU it asks for non-existent
    /// <c>_ru</c> sprites, flooding the log with "[ResLoader]: Failed to load resource" and leaving
    /// blank tab icons.
    ///
    /// We replace the loader for RU only (other languages keep the stock method) and reproduce the
    /// original's four states exactly:
    ///   • normal      → <c>Image.sprite</c>               state = isCurrent ? 2 : 0
    ///   • highlighted + selected → <c>SpriteState</c>     state = isCurrent ? 2 : 1
    ///   • pressed     → <c>SpriteState</c>                state = 0
    ///   • disabled    → <c>SpriteState</c>                state = 3, then <c>btn.spriteState</c> is set
    /// Each state is routed through <see cref="LocalizedImage.LoadSprite"/> — the single RU PNG → EN → CN
    /// policy — so the fallback order matches every other localized image. The interaction states are
    /// chained so the value-type <see cref="SpriteState"/> is fully populated before it is copied in.
    ///
    /// NB: a per-call-site patch on purpose. The shared loader <c>ResLoader.Load&lt;Sprite&gt;</c> is a
    /// generic method; patching it leaks to every reference-type <c>Load&lt;T&gt;</c> under Mono code-
    /// sharing and breaks prefab/atlas loads — so we patch the concrete (non-generic) button method.
    /// </summary>
    [HarmonyPatch(typeof(CharacterMenuToggleGroup), "LoadDropdownEntryButtonSprite")]
    internal static class CharacterMenuButtonSpritePatch
    {
        // path is a "{0}{1}" pattern: {0}=language, {1}=state. Build the "ru" resource path per state
        // and let the shared policy handle RU PNG → EN → CN.
        private static readonly Action<string, Action<Sprite>> ResLoad =
            (p, cb) => ResLoader.Load<Sprite>(p, cb);

        private static bool Prefix(CButton btn, string path, bool isCurrent)
        {
            if (!RuLocale.IsRu || btn == null || string.IsNullOrEmpty(path))
                return true; // not RU (or nothing to load) → run the stock method

            CImage btnImg = btn.GetComponent<CImage>();
            SpriteState spriteState = new SpriteState();

            void LoadState(int state, Action<Sprite> onLoaded) =>
                LocalizedImage.LoadSprite(
                    string.Format(System.Globalization.CultureInfo.InvariantCulture, path, "ru", state),
                    ResLoad, onLoaded);

            LoadState(isCurrent ? 2 : 0, s =>
            {
                if (btnImg != null)
                    btnImg.sprite = s;
            });

            LoadState(isCurrent ? 2 : 1, s1 =>
            {
                spriteState.highlightedSprite = s1;
                spriteState.selectedSprite = s1;
                LoadState(0, s2 =>
                {
                    spriteState.pressedSprite = s2;
                    LoadState(3, s3 =>
                    {
                        spriteState.disabledSprite = s3;
                        btn.spriteState = spriteState;
                    });
                });
            });

            return false; // skip the stock method
        }
    }
}
