import { App, Modal, Setting } from "obsidian";
import type { Category, TimelineItem } from "./types";
import { formatTime, parseTime } from "./parser";

export interface EditBlockResult {
	action: "save" | "delete";
	content: string;
	tag: string;
	startMinutes: number;
	endMinutes: number;
}

export class EditBlockModal extends Modal {
	private item: TimelineItem;
	private categories: Category[];
	private onSubmit: (result: EditBlockResult) => void;

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

		contentEl.createEl("h3", { text: "Edit Block" });

		// Time inputs
		let startValue = formatTime(this.item.planTime.start);
		let endValue = formatTime(this.item.planTime.end);

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
		});
		startInput.style.padding = "4px";
		startInput.addEventListener("change", () => {
			startValue = startInput.value;
		});

		timeContainer.createSpan({ text: " - " });

		const endInput = timeContainer.createEl("input", {
			type: "time",
			value: endValue,
		});
		endInput.style.padding = "4px";
		endInput.addEventListener("change", () => {
			endValue = endInput.value;
		});

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
					if (e.key === "Enter") {
						e.preventDefault();
						this.submitSave(contentValue, selectedTag, startValue, endValue);
					}
				});
			});

		// Category selection
		let selectedTag = this.item.tags[0] || (this.categories.length > 0 ? this.categories[0].tag : "");
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

		// Action buttons
		const actions = new Setting(contentEl);

		actions.addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					this.submitSave(contentValue, selectedTag, startValue, endValue);
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
		this.contentEl.empty();
	}
}
