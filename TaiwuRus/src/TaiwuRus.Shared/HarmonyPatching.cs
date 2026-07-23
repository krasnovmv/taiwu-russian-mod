using System;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;

namespace TaiwuRus.Shared
{
    /// <summary>
    /// All-or-nothing replacement for <c>Harmony.PatchAll</c>.
    ///
    /// <c>PatchAll</c> patches one class at a time and throws on the FIRST missing target,
    /// leaving every alphabetically-earlier patch live — a half-patched session (mixed
    /// RU/EN) unless the mod loader reliably calls <c>Dispose()</c> after a failed
    /// <c>Initialize()</c>, which nothing guarantees. It also reports only that first
    /// casualty, so a game update that renames several members costs one
    /// crash-fix-rebuild cycle each.
    ///
    /// This walks every patch class itself, collects EVERY failure (a vanished string-named
    /// target, a type-load error from a removed game type), and on any failure rolls all
    /// applied patches back and aborts with one grep-able log line listing all casualties —
    /// the whole post-update triage in a single log read.
    ///
    /// References HarmonyLib, so like <c>RuLocale</c> this file is source-linked into the
    /// Frontend and Backend projects only, not the standalone Shared build.
    /// </summary>
    internal static class HarmonyPatching
    {
        /// <summary>
        /// Patch every Harmony-annotated class in <paramref name="assembly"/>, or —
        /// if any class fails — unpatch everything, log one summary line via
        /// <paramref name="logError"/> and throw. Never leaves a partial patch set behind.
        /// </summary>
        public static void PatchAllOrAbort(Harmony harmony, Assembly assembly, Action<string> logError)
        {
            var failures = new List<string>();

            Type?[] types;
            try
            {
                types = assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException e)
            {
                // A patch class whose signature/attribute references a removed game type
                // fails to LOAD; Harmony's own enumeration would silently skip it (its
                // patches would just never apply). Surface each loader error and keep
                // patching the classes that did load, so the summary is complete.
                types = e.Types;
                foreach (Exception? loader in e.LoaderExceptions)
                {
                    if (loader != null)
                        failures.Add("type load: " + loader.Message);
                }
            }

            foreach (Type? type in types)
            {
                if (type == null)
                    continue;
                try
                {
                    harmony.CreateClassProcessor(type).Patch();
                }
                catch (Exception e)
                {
                    failures.Add(type.Name + ": " + Describe(e));
                }
            }

            if (failures.Count == 0)
                return;

            harmony.UnpatchSelf();
            logError("[TaiwuRus] ABORT: " + failures.Count + " patch class(es) failed after a game update; "
                + "all patches rolled back:\n  " + string.Join("\n  ", failures.ToArray()));
            throw new InvalidOperationException(
                "[TaiwuRus] " + failures.Count + " patch class(es) failed; see the log for the full list");
        }

        /// <summary>The failure in one line: Harmony wraps the interesting part (e.g. the
        /// missing method name) in an inner exception; surface both messages, no stack.</summary>
        private static string Describe(Exception e)
        {
            Exception? inner = e.InnerException;
            return inner == null ? e.Message : e.Message + " (" + inner.Message + ")";
        }
    }
}
