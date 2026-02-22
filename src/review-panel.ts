import type { App } from "obsidian";
import type { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { WeekFlowSettings } from "./types";
import { saveDailyReviewContent } from "./daily-note";

export interface ReviewPanelDeps {
	app: App;
	settings: WeekFlowSettings;
	dates: Moment[];
	contentEl: HTMLElement;
	withSelfWriteGuard: <T>(fn: () => Promise<T>) => Promise<T>;
	saveSettings: () => void;
}

export class ReviewPanelController {
	private reviewData: Map<string, string> = new Map();
	private reviewDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private deps: ReviewPanelDeps;

	constructor(deps: ReviewPanelDeps) {
		this.deps = deps;
	}

	/** Replace stored deps (called on each refresh when dates/settings may change) */
	updateDeps(deps: ReviewPanelDeps): void {
		this.deps = deps;
	}

	loadData(data: Map<string, string>): void {
		this.reviewData = data;
	}

	getReviewData(): Map<string, string> {
		return this.reviewData;
	}

	render(container: HTMLElement, visibleDays: number, dayOffset: number): void {
		// Resize handle (between grid and review panel)
		const handle = container.createDiv({ cls: "weekflow-review-resize-handle" });
		if (!this.deps.settings.reviewPanelOpen) {
			handle.style.display = "none";
		}
		this.initResize(handle);

		const panel = container.createDiv({ cls: "weekflow-review-panel" });
		if (!this.deps.settings.reviewPanelOpen) {
			panel.addClass("collapsed");
		} else if (this.deps.settings.reviewPanelHeight > 0) {
			panel.style.height = `${this.deps.settings.reviewPanelHeight}px`;
			panel.style.minHeight = "0";
			panel.style.maxHeight = "none";
		}

		this.renderContent(panel, visibleDays, dayOffset);
	}

	update(visibleDays: number, dayOffset: number): void {
		const panel = this.deps.contentEl.querySelector(".weekflow-review-panel");
		if (!panel || panel.hasClass("collapsed")) return;

		const content = panel.querySelector(".weekflow-review-content") as HTMLElement | null;
		if (!content) return;

		content.empty();
		this.fillContent(content, visibleDays, dayOffset);
	}

	toggle(): void {
		this.deps.settings.reviewPanelOpen = !this.deps.settings.reviewPanelOpen;
		this.deps.saveSettings();
		const open = this.deps.settings.reviewPanelOpen;

		const panelEl = this.deps.contentEl.querySelector(
			".weekflow-review-panel"
		) as HTMLElement | null;
		const handleEl = this.deps.contentEl.querySelector(
			".weekflow-review-resize-handle"
		) as HTMLElement | null;

		if (panelEl) {
			if (open) {
				panelEl.removeClass("collapsed");
				const h = this.deps.settings.reviewPanelHeight;
				if (h > 0) {
					panelEl.style.height = `${h}px`;
					panelEl.style.minHeight = "0";
					panelEl.style.maxHeight = "none";
				} else {
					panelEl.style.removeProperty("height");
					panelEl.style.removeProperty("min-height");
					panelEl.style.removeProperty("max-height");
				}
			} else {
				panelEl.style.removeProperty("height");
				panelEl.style.removeProperty("min-height");
				panelEl.style.removeProperty("max-height");
				panelEl.addClass("collapsed");
			}
		}
		if (handleEl) {
			handleEl.style.display = open ? "" : "none";
		}

		const toggleBtn = this.deps.contentEl.querySelector(
			".weekflow-review-toggle-btn"
		) as HTMLElement | null;
		if (toggleBtn) {
			toggleBtn.toggleClass("active", open);
		}
	}

	destroy(): void {
		for (const timer of this.reviewDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.reviewDebounceTimers.clear();
	}

	// ── Private ──

	private renderContent(panel: HTMLElement, visibleDays: number, dayOffset: number): void {
		const content = panel.createDiv({ cls: "weekflow-review-content" });
		this.fillContent(content, visibleDays, dayOffset);
	}

	private fillContent(content: HTMLElement, visibleDays: number, dayOffset: number): void {
		content.style.gridTemplateColumns = `60px repeat(${visibleDays}, 1fr)`;

		const spacer = content.createDiv({ cls: "weekflow-review-spacer" });
		spacer.createSpan({ text: "Review", cls: "weekflow-review-spacer-label" });

		for (let i = 0; i < visibleDays; i++) {
			const date = this.deps.dates[dayOffset + i];
			const dateKey = date.format("YYYY-MM-DD");
			const isToday = date.isSame(window.moment(), "day");

			const cell = content.createDiv({ cls: "weekflow-review-cell" });
			if (isToday) cell.addClass("weekflow-review-cell-today");

			const textarea = cell.createEl("textarea", {
				cls: "weekflow-review-textarea",
			});
			textarea.value = this.reviewData.get(dateKey) || "";
			textarea.placeholder = "Write review...";

			textarea.addEventListener("input", () => {
				this.debouncedSave(dateKey, textarea.value);
			});

			textarea.addEventListener("blur", () => {
				this.saveImmediate(dateKey, textarea.value);
			});
		}
	}

	private initResize(handle: HTMLElement): void {
		let startY = 0;
		let startHeight = 0;
		let panelEl: HTMLElement | null = null;

		const onPointerMove = (e: PointerEvent) => {
			if (!panelEl) return;
			const delta = startY - e.clientY;
			const newHeight = Math.max(60, Math.min(startHeight + delta, 500));
			panelEl.style.height = `${newHeight}px`;
			panelEl.style.minHeight = "0";
			panelEl.style.maxHeight = "none";
		};

		const onPointerUp = () => {
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";

			if (panelEl) {
				const height = panelEl.offsetHeight;
				this.deps.settings.reviewPanelHeight = height;
				this.deps.saveSettings();
			}
		};

		handle.addEventListener("pointerdown", (e) => {
			panelEl = handle.nextElementSibling as HTMLElement | null;
			if (!panelEl || panelEl.hasClass("collapsed")) return;

			e.preventDefault();
			handle.setPointerCapture(e.pointerId);
			startY = e.clientY;
			startHeight = panelEl.offsetHeight;
			document.body.style.cursor = "ns-resize";
			document.body.style.userSelect = "none";
			document.addEventListener("pointermove", onPointerMove);
			document.addEventListener("pointerup", onPointerUp);
		});
	}

	private debouncedSave(dateKey: string, text: string): void {
		this.reviewData.set(dateKey, text);
		const existing = this.reviewDebounceTimers.get(dateKey);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			this.reviewDebounceTimers.delete(dateKey);
			this.saveImmediate(dateKey, text);
		}, 300);
		this.reviewDebounceTimers.set(dateKey, timer);
	}

	private async saveImmediate(dateKey: string, text: string): Promise<void> {
		const pending = this.reviewDebounceTimers.get(dateKey);
		if (pending) {
			clearTimeout(pending);
			this.reviewDebounceTimers.delete(dateKey);
		}

		const dateIndex = this.deps.dates.findIndex(
			(d) => d.format("YYYY-MM-DD") === dateKey
		);
		if (dateIndex === -1) return;

		await this.deps.withSelfWriteGuard(() =>
			saveDailyReviewContent(this.deps.app.vault, this.deps.dates[dateIndex], this.deps.settings, text)
		);
	}
}
