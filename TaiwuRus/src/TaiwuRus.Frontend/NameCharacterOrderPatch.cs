using Game.Components.Character;
using HarmonyLib;
using TaiwuRus.Shared;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// <see cref="NameCharacter"/> renders a person's display name by ordering the given/family parts
    /// by language: EN → <c>Given + Family</c> (western order), everything else → <c>Family + Given</c>
    /// (Chinese order). RU isn't "EN", so a Russian-entered name comes out surname-first
    /// (e.g. "ИвановИван"). Mirror the EN ordering for RU — same per-subsystem RU gate
    /// (<see cref="RuLocale.IsRu"/>) the rest of the plugin uses.
    ///
    /// We rebuild from the public part getters rather than trying to re-split <c>__result</c> (the
    /// engine already concatenated it). We match EN exactly, separator and all (EN adds none), so RU
    /// behaves identically to the game's own western-order path — no invented formatting.
    /// </summary>
    [HarmonyPatch(typeof(NameCharacter), nameof(NameCharacter.Name), MethodType.Getter)]
    internal static class NameCharacterNamePatch
    {
        private static void Postfix(NameCharacter __instance, ref string __result)
        {
            if (!RuLocale.IsRu)
                return;
            __result = __instance.GivenName + __instance.FamilyName;
        }
    }

    /// <summary>RU→EN ordering for the "fixed" variant (blanks shown as a red placeholder). See
    /// <see cref="NameCharacterNamePatch"/>.</summary>
    [HarmonyPatch(typeof(NameCharacter), nameof(NameCharacter.FixedName), MethodType.Getter)]
    internal static class NameCharacterFixedNamePatch
    {
        private static void Postfix(NameCharacter __instance, ref string __result)
        {
            if (!RuLocale.IsRu)
                return;
            __result = __instance.FixedGivenName + __instance.FixedFamilyName;
        }
    }
}
