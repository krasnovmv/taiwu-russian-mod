return {
	Title = "TaiwuRus",
	Author = "KrasnoVMV",
	Version = "0.1.0.0",
	GameVersion = "1.0.44.0",
	Description = "Русская локализация The Scroll of Taiwu (в разработке).",
	BackendPlugins = {
		[1] = "TaiwuRusB.dll",
	},
	FrontendPlugins = {
		[1] = "TaiwuRusF.dll",
	},
	TagList = {
		[1] = "Display",
		[2] = "Modifications",
	},
	NeedRestartWhenSettingChanged = true,
	DefaultSettings = {
		[1] = {
			SettingType = "Toggle",
			Key = "useImages",
			DisplayName = "Использовать картинки?",
			Description = "Чтобы использовались русифицированные картинки, включите эту настройку",
			GroupName = "Основные",
			DefaultValue = false,
		},
	},
	Source = 0,
	FileId = 1,
	Visibility = 0,
	UpdateLogList = { },
	ChangeConfig = false,
	HasArchive = false,
	WorkshopCover = nil,
	SettingGroups = {
		[1] = "Основные",
	},
}
