namespace TaiwuRus.Shared
{
    /// <summary>
    /// Constants shared by the frontend and backend plugins. This file is
    /// source-linked into both projects (see their .csproj).
    /// </summary>
    internal static class ModInfo
    {
        public const string Author = "KrasnoVMV";

        /// <summary>Single source of the mod version: the assembly version, the PluginConfig
        /// attributes and the Author/Version fields of dist/Config.Lua (rewritten by the
        /// SyncConfigLua build target) all come from here. Keep the four-part form the game's
        /// mod list expects.</summary>
        public const string Version = "0.4.0.0";

        /// <summary>Game build this release targets; copied into GameVersion in dist/Config.Lua
        /// by the SyncConfigLua build target.</summary>
        public const string GameVersion = "1.0.58.0";
    }
}
