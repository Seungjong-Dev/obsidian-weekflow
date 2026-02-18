import { App, Modal, Setting } from "obsidian";
import type { Category, TimeRange } from "./types";
import { formatTime, parseTime } from "./parser";

export interface BlockModalResult {
	content: string;
	tag: string;
	startMinutes: number;
	endMinutes: number;
}

export class BlockModal extends Modal {
	private result: BlockModalResult | null = null;
	private onSubmit: (result: BlockModalResult) => void;
	private planTime: TimeRange;
	private mode: "plan" | "actual";
	private categories: Category[];

	constructor(
		app: App,
		planTime: TimeRange,
		mode: "plan" | "actual",
		categories: Category[],
		onSubmit: (result: BlockModalResult) => void
	) {
		super(app);
		this.planTime = planTime;
		this.mode = mode;
		this.categories = categories;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "New Block" });

		// Time inputs (editable)
		let startValue = formatTime(this.planTime.start);
		let endValue = formatTime(this.planTime.end);

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

		const modeLabel = timeSetting.descEl;
		modeLabel.setText(`${this.mode} mode`);

		// Content input
		let contentValue = "";
		new Setting(contentEl)
			.setName("Content")
			.addText((text) => {
				text.setPlaceholder("What are you doing?").onChange((value) => {
					contentValue = value;
				});
				// Auto-focus
				setTimeout(() => text.inputEl.focus(), 50);
				// Enter key to submit
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.submit(contentValue, selectedTag, startValue, endValue);
					}
				});
			});

		// Category selection
		let selectedTag = this.categories.length > 0 ? this.categories[0].tag : "";
		const catContainer = contentEl.createDiv({ cls: "weekflow-modal-categories" });
		catContainer.style.display = "flex";
		catContainer.style.gap = "6px";
		catContainer.style.flexWrap = "wrap";
		catContainer.style.marginBottom = "16px";

		const catButtons: HTMLElement[] = [];
		this.categories.forEach((cat, i) => {
			const btn = catContainer.createEl("button", {
				cls: "weekflow-palette-btn",
			});
			const dot = btn.createSpan({ cls: "weekflow-palette-dot" });
			dot.style.backgroundColor = cat.color;
			btn.createSpan({ text: cat.label || cat.tag });

			if (i === 0) btn.addClass("active");

			btn.addEventListener("click", () => {
				catButtons.forEach((b) => b.removeClass("active"));
				btn.addClass("active");
				selectedTag = cat.tag;
			});

			catButtons.push(btn);
		});

		// Action buttons
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Create")
					.setCta()
					.onClick(() => {
						this.submit(contentValue, selectedTag, startValue, endValue);
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	private submit(content: string, tag: string, startStr: string, endStr: string) {
		if (!content.trim()) return;

		const startMinutes = parseTime(startStr);
		const endMinutes = parseTime(endStr);
		if (endMinutes <= startMinutes) return;

		this.result = { content: content.trim(), tag, startMinutes, endMinutes };
		this.onSubmit(this.result);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
