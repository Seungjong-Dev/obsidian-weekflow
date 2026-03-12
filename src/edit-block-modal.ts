import { App, Modal, Setting } from "obsidian";
import type { Category, TimelineItem } from "./types";
import { formatTime, parseTime } from "./parser";
import { setupModalKeyboardAvoidance } from "./modal-keyboard";

export interface EditBlockResult {
	action: "save" | "delete" | "complete" | "uncomplete";
	content: string;
	tag: string;
	startMinutes: number;
	endMinutes: number;
	actualStartMinutes?: number;
	actualEndMinutes?: number;
}

export class EditBlockModal extends Modal {
	private item: TimelineItem;
	private categories: Category[];
	private onSubmit: (result: EditBlockResult) => void;
	private keyboardCleanup: (() => void) | null = null;

	constructor(
		app: App,
		item: TimelineItem,
		categories: Category[],
		onSubmit: (result: EditBlockResult) => void
	) {
		super(app);
		this.item = item;
		this.categories = categories;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.keyboardCleanup = setupModalKeyboardAvoidance(this.modalEl);

		const isActual = this.item.checkbox === "actual";

		contentEl.createEl("h3", { text: "Edit Block" });

		// Variable declarations (used by closures below)
		let startValue = formatTime(this.item.planTime.start);
		let endValue = formatTime(this.item.planTime.end);
		let actualStartValue = "";
		let actualEndValue = "";
		let selectedTag = this.item.tags[0] || (this.categories.length > 0 ? this.categories[0].tag : "");

		// Content input
		let contentValue = this.item.content;
		new Setting(contentEl)
			.setName("Content")
			.addText((text) => {
				text.setValue(this.item.content).onChange((value) => {
					contentValue = value;
				});
				setTimeout(() => text.inputEl.focus(), 50);
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						if (isActual) {
							this.submitActualSave(contentValue, selectedTag, actualStartValue, actualEndValue);
						} else {
							this.submitSave(contentValue, selectedTag, startValue, endValue);
						}
					}
				});
			});

		// Category selection
		const catContainer = contentEl.createDiv({ cls: "weekflow-modal-categories" });
		catContainer.style.display = "flex";
		catContainer.style.gap = "6px";
		catContainer.style.flexWrap = "wrap";
		catContainer.style.marginBottom = "16px";

		const catButtons: HTMLElement[] = [];
		this.categories.forEach((cat) => {
			const btn = catContainer.createEl("button", {
				cls: "weekflow-palette-btn",
			});
			const dot = btn.createSpan({ cls: "weekflow-palette-dot" });
			dot.style.backgroundColor = cat.color;
			btn.createSpan({ text: cat.label || cat.tag });

			if (selectedTag === cat.tag) btn.addClass("active");

			btn.addEventListener("click", () => {
				catButtons.forEach((b) => b.removeClass("active"));
				btn.addClass("active");
				selectedTag = cat.tag;
			});

			catButtons.push(btn);
		});

		// Time inputs
		if (isActual) {
			// Plan time: read-only display
			const planSetting = new Setting(contentEl).setName("Plan time");
			planSetting.controlEl.createSpan({
				text: `${formatTime(this.item.planTime.start)} - ${formatTime(this.item.planTime.end)}`,
				cls: "weekflow-edit-readonly-time",
			});

			// Actual time: editable
			const actualTime = this.item.actualTime || this.item.planTime;
			actualStartValue = formatTime(actualTime.start);
			actualEndValue = formatTime(actualTime.end);

			const actTimeSetting = new Setting(contentEl).setName("Actual time");
			const actTimeContainer = actTimeSetting.controlEl.createDiv({
				cls: "weekflow-edit-time-container",
			});
			actTimeContainer.style.display = "flex";
			actTimeContainer.style.gap = "8px";
			actTimeContainer.style.alignItems = "center";

			const actStartInput = actTimeContainer.createEl("input", {
				type: "time",
				value: actualStartValue,
				attr: { step: "300" },
			});
			actStartInput.style.padding = "4px";
			actStartInput.addEventListener("input", () => {
				actualStartValue = actStartInput.value;
			});

			actTimeContainer.createSpan({ text: " - " });

			const actEndInput = actTimeContainer.createEl("input", {
				type: "time",
				value: actualEndValue,
				attr: { step: "300" },
			});
			actEndInput.style.padding = "4px";
			actEndInput.addEventListener("input", () => {
				actualEndValue = actEndInput.value;
			});
		} else {
			// Plan block: editable time
			const timeSetting = new Setting(contentEl).setName("Time");
			const timeContainer = timeSetting.controlEl.createDiv({
				cls: "weekflow-edit-time-container",
			});
			timeContainer.style.display = "flex";
			timeContainer.style.gap = "8px";
			timeContainer.style.alignItems = "center";

			const startInput = timeContainer.createEl("input", {
				type: "time",
				value: startValue,
				attr: { step: "300" },
			});
			startInput.style.padding = "4px";
			startInput.addEventListener("input", () => {
				startValue = startInput.value;
			});

			timeContainer.createSpan({ text: " - " });

			const endInput = timeContainer.createEl("input", {
				type: "time",
				value: endValue,
				attr: { step: "300" },
			});
			endInput.style.padding = "4px";
			endInput.addEventListener("input", () => {
				endValue = endInput.value;
			});
		}

		// Action buttons
		const actions = new Setting(contentEl);

		actions.addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					if (isActual) {
						this.submitActualSave(contentValue, selectedTag, actualStartValue, actualEndValue);
					} else {
						this.submitSave(contentValue, selectedTag, startValue, endValue);
					}
				})
		);

		actions.addButton((btn) =>
			btn.setButtonText("Cancel").onClick(() => {
				this.close();
			})
		);

		actions.addButton((btn) =>
			btn
				.setButtonText("Delete")
				.setWarning()
				.onClick(() => {
					this.onSubmit({
						action: "delete",
						content: "",
						tag: "",
						startMinutes: 0,
						endMinutes: 0,
					});
					this.close();
				})
		);

		// Complete / Uncomplete toggle button (not shown for deferred)
		if (this.item.checkbox === "plan") {
			actions.addButton((btn) =>
				btn.setButtonText("Mark as Done").onClick(() => {
					this.onSubmit({
						action: "complete",
						content: "",
						tag: "",
						startMinutes: 0,
						endMinutes: 0,
					});
					this.close();
				})
			);
		} else if (this.item.checkbox === "actual") {
			actions.addButton((btn) =>
				btn.setButtonText("Mark as Incomplete").onClick(() => {
					this.onSubmit({
						action: "uncomplete",
						content: "",
						tag: "",
						startMinutes: 0,
						endMinutes: 0,
					});
					this.close();
				})
			);
		}
	}

	private submitActualSave(content: string, tag: string, actualStartStr: string, actualEndStr: string) {
		if (!content.trim()) return;

		const actualStartMinutes = parseTime(actualStartStr);
		const actualEndMinutes = parseTime(actualEndStr);
		if (actualEndMinutes <= actualStartMinutes) return;

		this.onSubmit({
			action: "save",
			content: content.trim(),
			tag,
			startMinutes: this.item.planTime.start,
			endMinutes: this.item.planTime.end,
			actualStartMinutes,
			actualEndMinutes,
		});
		this.close();
	}

	private submitSave(content: string, tag: string, startStr: string, endStr: string) {
		if (!content.trim()) return;

		const startMinutes = parseTime(startStr);
		const endMinutes = parseTime(endStr);
		if (endMinutes <= startMinutes) return;

		this.onSubmit({
			action: "save",
			content: content.trim(),
			tag,
			startMinutes,
			endMinutes,
		});
		this.close();
	}

	onClose() {
		this.keyboardCleanup?.();
		this.keyboardCleanup = null;
		this.contentEl.empty();
	}
}
