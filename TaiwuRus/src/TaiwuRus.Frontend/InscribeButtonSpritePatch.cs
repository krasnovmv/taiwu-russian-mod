using FrameWork.UI.LanguageRule;
using FrameWork.UISystem.UIElements;
using Game.Views.CharacterMenu;
using HarmonyLib;
using UnityEngine.UI;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// The CharacterMenu "inscribe" (mirror) button loads its icon states through
    /// <c>ViewCharacterMenuInfo.LoadInteractiveButtonSprite(CButton, string)</c>, formatting the
    /// per-state pattern <c>ui9_btn_mirro_{0}_{1}</c> ({0}=language, {1}=state) and loading it via
    /// <c>ResLoader.Load&lt;Sprite&gt;</c>. Like the tab buttons (see
    /// <see cref="CharacterMenuButtonSpritePatch"/>), this path does NOT go through
    /// <c>LanguageRuleImagePattern</c>, so under RU it asks for non-existent <c>_ru</c> atlas sprites.
    ///
    /// We replace the loader for RU only (other languages keep the stock method) and reproduce the
    /// original's four states exactly — normal (0), highlighted+selected (1), pressed (2),
    /// disabled (3) — but route each through <see cref="ButtonSpriteLoader"/>, which prefers a shipped
    /// Russian PNG and falls back to the English atlas sprite. The interaction states are chained so
    /// the value-type <see cref="SpriteState"/> is fully populated before it is copied into the button.
    ///
    /// Patched at this concrete (non-generic) method on purpose: the shared loader
    /// <c>ResLoader.Load&lt;Sprite&gt;</c> is generic, and patching it leaks to every reference-type
    /// <c>Load&lt;T&gt;</c> under Mono code-sharing (breaking prefab/atlas loads).
    /// </summary>
    [HarmonyPatch(typeof(ViewCharacterMenuInfo), "LoadInteractiveButtonSprite")]
    internal static class InscribeButtonSpritePatch
    {
        private static bool Prefix(CButton btn, string path)
        {
            if (LocalStringManager.CurLanguageKey != "RU" || btn == null || string.IsNullOrEmpty(path))
                return true; // not RU (or nothing to load) → run the stock method

            CImage btnImg = btn.GetComponent<CImage>();
            SpriteState spriteState = new SpriteState();

            ButtonSpriteLoader.LoadState(path, 0, s =>
            {
                if (btnImg != null)
                    btnImg.sprite = s;
            });

            ButtonSpriteLoader.LoadState(path, 1, s1 =>
            {
                spriteState.highlightedSprite = s1;
                spriteState.selectedSprite = s1;
                ButtonSpriteLoader.LoadState(path, 2, s2 =>
                {
                    spriteState.pressedSprite = s2;
                    ButtonSpriteLoader.LoadState(path, 3, s3 =>
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
