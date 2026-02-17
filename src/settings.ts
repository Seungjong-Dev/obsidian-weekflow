import { App, PluginSettingTab, Setting } from "obsidian";
import type WeekFlowPlugin from "./main";
import type { Category } from "./types";

export class WeekFlowSettingTab extends PluginSettingTab {
	plugin: WeekFlowPlugin;

	constructor(app: App, plugin: WeekFlowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "WeekFlow Settings" });

		// Daily Note Path
		const pathSetting = new Setting(containerEl)
			.setName("Daily note path")
			.setDesc("Path pattern using moment.js tokens (e.g., YYYY-MM-DD)")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dailyNotePath)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotePath = value;
						await this.plugin.saveSettings();
						updatePathPreview();
					})
			);

		const pathPreviewEl = pathSetting.descEl.createDiv({
			cls: "weekflow-setting-preview",
		});
		const updatePathPreview = () => {
			const preview = window.moment().format(this.plugin.settings.dailyNotePath);
			pathPreviewEl.setText(`📄 Preview: ${preview}.md`);
		};
		updatePathPreview();

		// Daily Note Template Path
		new Setting(containerEl)
			.setName("Daily note template")
			.setDesc("Path to template file used when creating new daily notes (leave empty to skip)")
			.addText((text) =>
				text
					.setPlaceholder("Templates/Daily Note")
					.setValue(this.plugin.settings.dailyNoteTemplatePath)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteTemplatePath = value;
						await this.plugin.saveSettings();
					})
			);

		// Timeline Heading
		new Setting(containerEl)
			.setName("Timeline heading")
			.setDesc("Heading under which timeline items are stored")
			.addText((text) =>
				text
					.setPlaceholder("## Timeline")
					.setValue(this.plugin.settings.timelineHeading)
					.onChange(async (value) => {
						this.plugin.settings.timelineHeading = value;
						await this.plugin.saveSettings();
					})
			);

		// Day Start Hour
		new Setting(containerEl)
			.setName("Day start hour")
			.setDesc("First hour shown in the timetable (0-23)")
			.addSlider((slider) =>
				slider
					.setLimits(0, 23, 1)
					.setValue(this.plugin.settings.dayStartHour)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.dayStartHour = value;
						await this.plugin.saveSettings();
					})
			);

		// Day End Hour
		new Setting(containerEl)
			.setName("Day end hour")
			.setDesc("Last hour shown in the timetable (1-24)")
			.addSlider((slider) =>
				slider
					.setLimits(1, 24, 1)
					.setValue(this.plugin.settings.dayEndHour)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.dayEndHour = value;
						await this.plugin.saveSettings();
					})
			);

		// Week Start Day
		new Setting(containerEl)
			.setName("Week start day")
			.setDesc("First day of the week")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"0": "Sunday",
						"1": "Monday",
						"2": "Tuesday",
						"3": "Wednesday",
						"4": "Thursday",
						"5": "Friday",
						"6": "Saturday",
					})
					.setValue(String(this.plugin.settings.weekStartDay))
					.onChange(async (value) => {
						this.plugin.settings.weekStartDay = parseInt(value);
						await this.plugin.saveSettings();
					})
			);

		// Default Mode
		new Setting(containerEl)
			.setName("Default mode")
			.setDesc("Default input mode when opening the view")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ plan: "Plan", actual: "Actual" })
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value: "plan" | "actual") => {
						this.plugin.settings.defaultMode = value;
						await this.plugin.saveSettings();
					})
			);

		// Planning Panel section
		containerEl.createEl("h3", { text: "Planning Panel" });

		// Inbox Note Path
		const inboxPathSetting = new Setting(containerEl)
			.setName("Inbox note path")
			.setDesc("Path pattern for weekly inbox note (moment.js tokens)")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-[W]ww")
					.setValue(this.plugin.settings.inboxNotePath)
					.onChange(async (value) => {
						this.plugin.settings.inboxNotePath = value;
						await this.plugin.saveSettings();
						updateInboxPreview();
					})
			);

		const inboxPreviewEl = inboxPathSetting.descEl.createDiv({
			cls: "weekflow-setting-preview",
		});
		const updateInboxPreview = () => {
			const preview = window.moment().format(this.plugin.settings.inboxNotePath);
			inboxPreviewEl.setText(`Preview: ${preview}.md`);
		};
		updateInboxPreview();

		// Inbox Heading
		new Setting(containerEl)
			.setName("Inbox heading")
			.setDesc("Heading under which inbox items are stored")
			.addText((text) =>
				text
					.setPlaceholder("### To Do")
					.setValue(this.plugin.settings.inboxHeading)
					.onChange(async (value) => {
						this.plugin.settings.inboxHeading = value;
						await this.plugin.saveSettings();
					})
			);

		// Default Block Duration
		new Setting(containerEl)
			.setName("Default block duration")
			.setDesc("Duration (minutes) when dragging inbox items to grid")
			.addSlider((slider) =>
				slider
					.setLimits(10, 120, 10)
					.setValue(this.plugin.settings.defaultBlockDuration)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultBlockDuration = value;
						await this.plugin.saveSettings();
					})
			);

		// Project Integration section
		containerEl.createEl("h3", { text: "Project Integration" });

		new Setting(containerEl)
			.setName("Project tag")
			.setDesc("Tag used to identify project notes (without #)")
			.addText((text) =>
				text
					.setPlaceholder("type/project")
					.setValue(this.plugin.settings.projectTag)
					.onChange(async (value) => {
						this.plugin.settings.projectTag = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Project status field")
			.setDesc("Frontmatter field name for project status")
			.addText((text) =>
				text
					.setPlaceholder("status")
					.setValue(this.plugin.settings.projectStatusField)
					.onChange(async (value) => {
						this.plugin.settings.projectStatusField = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Active project statuses")
			.setDesc("Comma-separated list of statuses considered active")
			.addText((text) =>
				text
					.setPlaceholder("🟡 In Progress, 🔴 Urgent")
					.setValue(this.plugin.settings.projectActiveStatuses.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.projectActiveStatuses = value
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Project tasks heading")
			.setDesc("Heading under which project tasks are listed")
			.addText((text) =>
				text
					.setPlaceholder("## Tasks")
					.setValue(this.plugin.settings.projectTasksHeading)
					.onChange(async (value) => {
						this.plugin.settings.projectTasksHeading = value;
						await this.plugin.saveSettings();
					})
			);

		// Review section
		containerEl.createEl("h3", { text: "Review" });

		new Setting(containerEl)
			.setName("Review heading")
			.setDesc("Heading under which daily review text is stored")
			.addText((text) =>
				text
					.setPlaceholder("## Review")
					.setValue(this.plugin.settings.reviewHeading)
					.onChange(async (value) => {
						this.plugin.settings.reviewHeading = value;
						await this.plugin.saveSettings();
					})
			);

		// Presets section
		containerEl.createEl("h3", { text: "Presets" });

		if (this.plugin.settings.presets.length === 0) {
			containerEl.createEl("p", {
				text: "No presets saved. Use the toolbar to create presets from the current day.",
				cls: "setting-item-description",
			});
		} else {
			for (let i = 0; i < this.plugin.settings.presets.length; i++) {
				const preset = this.plugin.settings.presets[i];
				new Setting(containerEl)
					.setName(preset.name)
					.setDesc(`${preset.slots.length} slot(s)`)
					.addExtraButton((btn) =>
						btn.setIcon("trash").onClick(async () => {
							this.plugin.settings.presets.splice(i, 1);
							await this.plugin.saveSettings();
							this.display();
						})
					);
			}
		}

		// Categories
		containerEl.createEl("h3", { text: "Categories" });

		this.plugin.settings.categories.forEach((cat, index) => {
			const s = new Setting(containerEl)
				.addText((text) =>
					text
						.setPlaceholder("tag")
						.setValue(cat.tag)
						.onChange(async (value) => {
							this.plugin.settings.categories[index].tag = value;
							await this.plugin.saveSettings();
						})
				)
				.addText((text) =>
					text
						.setPlaceholder("label")
						.setValue(cat.label)
						.onChange(async (value) => {
							this.plugin.settings.categories[index].label = value;
							await this.plugin.saveSettings();
						})
				)
				.addColorPicker((color) =>
					color.setValue(cat.color).onChange(async (value) => {
						this.plugin.settings.categories[index].color = value;
						await this.plugin.saveSettings();
					})
				)
				.addExtraButton((btn) =>
					btn.setIcon("trash").onClick(async () => {
						this.plugin.settings.categories.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
			s.infoEl.remove();
		});

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add category").onClick(async () => {
				this.plugin.settings.categories.push({
					tag: "",
					label: "",
					color: "#888888",
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);
	}
}
