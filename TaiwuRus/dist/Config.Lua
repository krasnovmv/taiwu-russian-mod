return {
	Title = "Свитки Тайву",
	Author = "KrasnoVMV",
	Version = "0.5.0.0",
	GameVersion = "1.0.58.0",
	Description = "Русская локализация The Scroll of Taiwu",
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
	FileId = 3757119125,
	Visibility = 0,
	UpdateLogList = {
		[1] = {
			Timestamp = 1783121942,
		},
		[2] = {
			Timestamp = 1783152293,
		},
		[3] = {
			Timestamp = 1783373324,
		},
		[4] = {
			Timestamp = 1783970763,
		},
		[5] = {
			Timestamp = 1783970785,
		},
	},
	ChangeConfig = false,
	HasArchive = false,
	SettingGroups = {
		[1] = "Основные",
	},
	Cover = "logo.png",
	WorkshopCover = "logo.png",
}
