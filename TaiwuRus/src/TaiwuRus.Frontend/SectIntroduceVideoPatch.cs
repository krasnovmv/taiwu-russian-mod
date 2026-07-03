using System.Collections.Generic;
using System.Reflection;
using System.Reflection.Emit;
using Game.Views.NewGame;
using HarmonyLib;

namespace TaiwuRus.Frontend
{
    /// <summary>
    /// The sect-introduction video on the new-game born-area page is gated by
    /// <c>CurLanguageKey == "CN" || CurLanguageKey == "EN"</c> (the .mp4 itself is language-agnostic —
    /// no language token in its path). RU is neither, so the intro never plays for Russian.
    ///
    /// Rather than reimplement the load (it reaches private fields + a domain singleton in an assembly
    /// the frontend doesn't reference), rewrite just the guard: the second comparand test
    /// (<c>== "EN"</c>) is replaced by <see cref="EnOrRu"/>, which also accepts "RU". CN keeps its own
    /// short-circuit; KO/CNH/JP still skip exactly as in vanilla — only RU changes, matching the
    /// plugin's per-subsystem RU=EN discipline. The original method body runs untouched.
    /// </summary>
    [HarmonyPatch(typeof(NewGameSubPageBornArea), "SectIntroducePlay")]
    internal static class SectIntroduceVideoPatch
    {
        // Original EN check → EN or RU. Static, one string arg, returns bool: same stack shape as the
        // string.op_Equality(string,string) it replaces once the "EN" literal push is dropped.
        public static bool EnOrRu(string key) => key == "EN" || key == "RU";

        private static IEnumerable<CodeInstruction> Transpiler(IEnumerable<CodeInstruction> instructions)
        {
            var codes = new List<CodeInstruction>(instructions);
            MethodInfo opEquality = AccessTools.Method(
                typeof(string), "op_Equality", new[] { typeof(string), typeof(string) });
            MethodInfo replacement = AccessTools.Method(typeof(SectIntroduceVideoPatch), nameof(EnOrRu));

            for (int i = 0; i + 1 < codes.Count; i++)
            {
                // Match `ldstr "EN"` immediately followed by `call string.op_Equality`.
                if (codes[i].opcode == OpCodes.Ldstr && (codes[i].operand as string) == "EN"
                    && codes[i + 1].opcode == OpCodes.Call && (codes[i + 1].operand as MethodInfo) == opEquality)
                {
                    // Drop the "EN" literal so only CurLanguageKey remains on the stack, then retarget the
                    // comparison call to our single-arg helper. Preserve labels/blocks on both instructions.
                    codes[i].opcode = OpCodes.Nop;
                    codes[i].operand = null;
                    codes[i + 1].operand = replacement;
                    return codes;
                }
            }

            // No match: game changed the guard. Leave IL untouched (RU stays unpatched) rather than
            // corrupt the method — the fallout is only the missing intro video, not a crash.
            UnityEngine.Debug.LogWarning("[TaiwuRus] SectIntroducePlay guard not found; RU intro video left unpatched");
            return codes;
        }
    }
}
