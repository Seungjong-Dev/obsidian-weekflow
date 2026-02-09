import { App, Modal, Setting } from "obsidian";
import type { Category, CheckboxState, TimelineItem, TimeRange } from "./types";
import { formatTime } from "./parser";

export interface BlockModalResult {
	content: string;
	tag: string;
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

		// Time display (read-only)
		new Setting(contentEl)
			.setName("Time")
			.setDesc(
				`${formatTime(this.planTime.start)} - ${formatTime(this.planTime.end)} (${this.mode} mode)`
			);

		// Content input
		let contentValue = "";
		const contentSetting = new Setting(contentEl)
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
						this.submit(contentValue, selectedTag);
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
						this.submit(contentValue, selectedTag);
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	private submit(content: string, tag: string) {
		if (!content.trim()) return;
		this.result = { content: content.trim(), tag };
		this.onSubmit(this.result);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
