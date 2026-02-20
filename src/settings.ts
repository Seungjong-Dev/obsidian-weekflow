import { App, PluginSettingTab, Setting } from "obsidian";
import type WeekFlowPlugin from "./main";
import type { CalendarSource, Category } from "./types";

export class WeekFlowSettingTab extends PluginSettingTab {
	plugin: WeekFlowPlugin;

	constructor(app: App, plugin: WeekFlowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private renderInboxSources(containerEl: HTMLElement): void {
		containerEl.empty();
		const sources = this.plugin.settings.inboxSources;

		sources.forEach((source, index) => {
			const row = containerEl.createDiv({ cls: "weekflow-inbox-source-row" });

			// Drag handle
			const handle = row.createSpan({ cls: "weekflow-inbox-source-handle", text: "≡" });
			handle.setAttribute("draggable", "true");

			handle.addEventListener("dragstart", (e) => {
				e.dataTransfer?.setData("text/plain", String(index));
				row.addClass("weekflow-inbox-source-dragging");
			});

			handle.addEventListener("dragend", () => {
				row.removeClass("weekflow-inbox-source-dragging");
			});

			row.addEventListener("dragover", (e) => {
				e.preventDefault();
				row.addClass("weekflow-inbox-source-dragover");
			});

			row.addEventListener("dragleave", () => {
				row.removeClass("weekflow-inbox-source-dragover");
			});

			row.addEventListener("drop", async (e) => {
				e.preventDefault();
				row.removeClass("weekflow-inbox-source-dragover");
				const fromIdx = parseInt(e.dataTransfer?.getData("text/plain") || "-1");
				if (fromIdx >= 0 && fromIdx !== index) {
					const [moved] = sources.splice(fromIdx, 1);
					sources.splice(index, 0, moved);
					await this.plugin.saveSettings();
					this.renderInboxSources(containerEl);
				}
			});

			// Path input
			const pathInput = row.createEl("input", { type: "text", cls: "weekflow-inbox-source-path" });
			pathInput.placeholder = "Path (e.g., Inbox.md or Projects/)";
			pathInput.value = source.path;
			pathInput.addEventListener("change", async () => {
				sources[index].path = pathInput.value;
				await this.plugin.saveSettings();
				this.updateSourceTypeLabel(row, pathInput.value);
			});

			// Heading input
			const headingInput = row.createEl("input", { type: "text", cls: "weekflow-inbox-source-heading" });
			headingInput.placeholder = "Heading (optional)";
			headingInput.value = source.heading;
			headingInput.addEventListener("change", async () => {
				sources[index].heading = headingInput.value;
				await this.plugin.saveSettings();
			});

			// Type label (Note/Folder auto-detect)
			const typeLabel = row.createSpan({ cls: "weekflow-inbox-source-type" });
			this.updateSourceTypeLabel(row, source.path);

			// Delete button
			const delBtn = row.createEl("button", { cls: "weekflow-inbox-source-delete" });
			delBtn.setText("✕");
			delBtn.addEventListener("click", async () => {
				sources.splice(index, 1);
				await this.plugin.saveSettings();
				this.renderInboxSources(containerEl);
			});
		});

		if (sources.length === 0) {
			containerEl.createEl("p", {
				text: "No inbox sources configured.",
				cls: "setting-item-description",
			});
		}
	}

	private updateSourceTypeLabel(row: HTMLElement, path: string): void {
		const label = row.querySelector(".weekflow-inbox-source-type") as HTMLElement | null;
		if (!label) return;

		const normalPath = path.trim();
		if (!normalPath) {
			label.setText("");
			return;
		}

		// Check vault for folder vs file
		const vault = this.app.vault;
		const abstract = vault.getAbstractFileByPath(normalPath);
		if (abstract && "children" in abstract) {
			label.setText("Folder");
			label.addClass("weekflow-inbox-source-type-folder");
			label.removeClass("weekflow-inbox-source-type-note");
		} else {
			label.setText("Note");
			label.removeClass("weekflow-inbox-source-type-folder");
			label.addClass("weekflow-inbox-source-type-note");
		}
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
			.setDesc("Hours before this are shown folded (collapsed) in the grid (0-23)")
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
			.setDesc("Hours from this onward are shown folded (collapsed) in the grid (1-24)")
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

		// Inbox Sources
		containerEl.createEl("h4", { text: "Inbox Sources" });

		const inboxDesc = containerEl.createEl("p", {
			text: "Add note or folder paths as inbox sources. Items are read from all sources. New items are written to the first note source. Drag to reorder priority.",
			cls: "setting-item-description",
		});

		const inboxListEl = containerEl.createDiv({ cls: "weekflow-inbox-sources-list" });
		this.renderInboxSources(inboxListEl);

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add source").onClick(async () => {
				this.plugin.settings.inboxSources.push({
					path: "",
					heading: "",
				});
				await this.plugin.saveSettings();
				this.renderInboxSources(inboxListEl);
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

		// Calendar Sources
		containerEl.createEl("h3", { text: "Calendar Sources" });

		new Setting(containerEl)
			.setName("Cache duration")
			.setDesc("Minutes to cache fetched ICS data (0 = no cache)")
			.addSlider((slider) =>
				slider
					.setLimits(0, 120, 5)
					.setValue(this.plugin.settings.calendarCacheDuration)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.calendarCacheDuration = value;
						await this.plugin.saveSettings();
					})
			);

		this.plugin.settings.calendarSources.forEach((source, index) => {
			const s = new Setting(containerEl)
				.addText((text) =>
					text
						.setPlaceholder("Name")
						.setValue(source.name)
						.onChange(async (value) => {
							this.plugin.settings.calendarSources[index].name = value;
							await this.plugin.saveSettings();
						})
				)
				.addText((text) =>
					text
						.setPlaceholder("ICS URL")
						.setValue(source.url)
						.onChange(async (value) => {
							this.plugin.settings.calendarSources[index].url = value;
							await this.plugin.saveSettings();
						})
				)
				.addColorPicker((color) =>
					color.setValue(source.color).onChange(async (value) => {
						this.plugin.settings.calendarSources[index].color = value;
						await this.plugin.saveSettings();
					})
				)
				.addToggle((toggle) =>
					toggle.setValue(source.enabled).onChange(async (value) => {
						this.plugin.settings.calendarSources[index].enabled = value;
						await this.plugin.saveSettings();
					})
				)
				.addExtraButton((btn) =>
					btn.setIcon("trash").onClick(async () => {
						this.plugin.settings.calendarSources.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
			s.infoEl.remove();
		});

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add calendar source").onClick(async () => {
				this.plugin.settings.calendarSources.push({
					id: Date.now().toString(36),
					name: "",
					url: "",
					color: "#4A90D9",
					enabled: true,
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);

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
