import { Modal, Setting, type App, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { PresetSlot, TimeSlotPreset } from "./types";
import { formatTime, parseTime } from "./parser";

/**
 * Modal for creating a preset from existing slots.
 */
export class CreatePresetModal extends Modal {
	private slots: PresetSlot[];
	private onSave: (preset: TimeSlotPreset) => void;
	private presetName = "";

	constructor(
		app: App,
		slots: PresetSlot[],
		onSave: (preset: TimeSlotPreset) => void
	) {
		super(app);
		this.slots = slots;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Save as Preset" });

		new Setting(contentEl)
			.setName("Preset name")
			.addText((text) =>
				text.setPlaceholder("e.g., Workday").onChange((value) => {
					this.presetName = value;
				})
			);

		contentEl.createEl("p", {
			text: `${this.slots.length} time slot(s) will be saved.`,
			cls: "setting-item-description",
		});

		// Show slot previews
		if (this.slots.length > 0) {
			const list = contentEl.createEl("ul");
			list.style.fontSize = "12px";
			list.style.color = "var(--text-muted)";
			for (const slot of this.slots) {
				const li = list.createEl("li");
				li.setText(
					`${formatTime(slot.start)}-${formatTime(slot.end)} ${slot.content}${slot.tag ? ` #${slot.tag}` : ""}`
				);
			}
		}

		const btnContainer = contentEl.createDiv();
		btnContainer.style.display = "flex";
		btnContainer.style.justifyContent = "flex-end";
		btnContainer.style.gap = "8px";
		btnContainer.style.marginTop = "16px";

		const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const saveBtn = btnContainer.createEl("button", {
			text: "Save",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", () => {
			if (!this.presetName.trim()) return;
			this.onSave({
				name: this.presetName.trim(),
				slots: [...this.slots],
			});
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * Modal for applying a preset to selected days.
 */
export class ApplyPresetModal extends Modal {
	private preset: TimeSlotPreset;
	private dates: Moment[];
	private onApply: (selectedDays: number[], overwrite: boolean) => void;
	private selectedDays: Set<number> = new Set();
	private overwrite = false;

	constructor(
		app: App,
		preset: TimeSlotPreset,
		dates: Moment[],
		onApply: (selectedDays: number[], overwrite: boolean) => void
	) {
		super(app);
		this.preset = preset;
		this.dates = dates;
		this.onApply = onApply;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", {
			text: `Apply: ${this.preset.name}`,
		});

		contentEl.createEl("p", {
			text: `${this.preset.slots.length} slot(s). Select days to apply:`,
			cls: "setting-item-description",
		});

		// Day checkboxes
		for (let d = 0; d < 7; d++) {
			const date = this.dates[d];
			new Setting(contentEl)
				.setName(date.format("ddd MM/DD"))
				.addToggle((toggle) =>
					toggle.onChange((value) => {
						if (value) {
							this.selectedDays.add(d);
						} else {
							this.selectedDays.delete(d);
						}
					})
				);
		}

		// Overwrite option
		new Setting(contentEl)
			.setName("Overwrite existing plan blocks")
			.setDesc(
				"If enabled, existing plan blocks on selected days will be removed first"
			)
			.addToggle((toggle) =>
				toggle.onChange((value) => {
					this.overwrite = value;
				})
			);

		const btnContainer = contentEl.createDiv();
		btnContainer.style.display = "flex";
		btnContainer.style.justifyContent = "flex-end";
		btnContainer.style.gap = "8px";
		btnContainer.style.marginTop = "16px";

		const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const applyBtn = btnContainer.createEl("button", {
			text: "Apply",
			cls: "mod-cta",
		});
		applyBtn.addEventListener("click", () => {
			if (this.selectedDays.size === 0) return;
			this.onApply([...this.selectedDays].sort(), this.overwrite);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * Modal for editing a preset's slots.
 */
export class PresetModal extends Modal {
	private preset: TimeSlotPreset;
	private onSave: (preset: TimeSlotPreset) => void;

	constructor(
		app: App,
		preset: TimeSlotPreset,
		onSave: (preset: TimeSlotPreset) => void
	) {
		super(app);
		this.preset = {
			name: preset.name,
			slots: preset.slots.map((s) => ({ ...s })),
		};
		this.onSave = onSave;
	}

	onOpen() {
		this.renderContent();
	}

	private renderContent() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Edit Preset" });

		new Setting(contentEl)
			.setName("Preset name")
			.addText((text) =>
				text
					.setValue(this.preset.name)
					.onChange((value) => {
						this.preset.name = value;
					})
			);

		contentEl.createEl("h4", { text: "Slots" });

		for (let i = 0; i < this.preset.slots.length; i++) {
			const slot = this.preset.slots[i];
			const s = new Setting(contentEl)
				.addText((text) =>
					text
						.setPlaceholder("HH:MM")
						.setValue(formatTime(slot.start))
						.onChange((value) => {
							const m = value.match(/^(\d{2}):(\d{2})$/);
							if (m) slot.start = parseTime(value);
						})
				)
				.addText((text) =>
					text
						.setPlaceholder("HH:MM")
						.setValue(formatTime(slot.end))
						.onChange((value) => {
							const m = value.match(/^(\d{2}):(\d{2})$/);
							if (m) slot.end = parseTime(value);
						})
				)
				.addText((text) =>
					text
						.setPlaceholder("content")
						.setValue(slot.content)
						.onChange((value) => {
							slot.content = value;
						})
				)
				.addText((text) =>
					text
						.setPlaceholder("tag")
						.setValue(slot.tag)
						.onChange((value) => {
							slot.tag = value;
						})
				)
				.addExtraButton((btn) =>
					btn.setIcon("trash").onClick(() => {
						this.preset.slots.splice(i, 1);
						this.renderContent();
					})
				);
			s.infoEl.remove();
		}

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Add slot").onClick(() => {
				this.preset.slots.push({
					start: 540,
					end: 600,
					content: "",
					tag: "",
				});
				this.renderContent();
			})
		);

		const btnContainer = contentEl.createDiv();
		btnContainer.style.display = "flex";
		btnContainer.style.justifyContent = "flex-end";
		btnContainer.style.gap = "8px";
		btnContainer.style.marginTop = "16px";

		const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const saveBtn = btnContainer.createEl("button", {
			text: "Save",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", () => {
			if (!this.preset.name.trim()) return;
			this.onSave(this.preset);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
