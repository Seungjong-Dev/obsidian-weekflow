import type { App } from "obsidian";
import { moment, setIcon } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { LogItem, WeekFlowSettings } from "./types";
import { appendDailyLog, saveDailyReviewContent } from "./daily-note";

export interface ReviewPanelDeps {
	app: App;
	settings: WeekFlowSettings;
	dates: Moment[];
	contentEl: HTMLElement;
	withSelfWriteGuard: <T>(fn: () => Promise<T>) => Promise<T>;
	saveSettings: () => void | Promise<void>;
	onNavigateLog?: (date: Moment, lineNumber: number) => void;
}

export class ReviewPanelController {
	private reviewData: Map<string, string> = new Map();
	private logData: Map<string, LogItem[]> = new Map();
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

	loadLogData(data: Map<string, LogItem[]>): void {
		this.logData = data;
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

	setMode(mode: "review" | "log"): void {
		if (this.deps.settings.reviewPanelMode === mode) return;
		this.deps.settings.reviewPanelMode = mode;
		this.deps.saveSettings();

		const panel = this.deps.contentEl.querySelector(".weekflow-review-panel");
		if (!panel) return;
		const content = panel.querySelector(".weekflow-review-content") as HTMLElement | null;
		if (!content) return;

		const visibleDays = this.lastVisibleDays;
		const dayOffset = this.lastDayOffset;
		content.empty();
		this.fillContent(content, visibleDays, dayOffset);
	}

	destroy(): void {
		for (const timer of this.reviewDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.reviewDebounceTimers.clear();
	}

	// ── Private ──

	private lastVisibleDays: number = 7;
	private lastDayOffset: number = 0;

	private renderContent(panel: HTMLElement, visibleDays: number, dayOffset: number): void {
		const content = panel.createDiv({ cls: "weekflow-review-content" });
		this.fillContent(content, visibleDays, dayOffset);
	}

	private fillContent(content: HTMLElement, visibleDays: number, dayOffset: number): void {
		this.lastVisibleDays = visibleDays;
		this.lastDayOffset = dayOffset;
		content.style.gridTemplateColumns = `60px repeat(${visibleDays}, 1fr)`;

		const spacer = content.createDiv({ cls: "weekflow-review-spacer" });
		this.renderModeSwitch(spacer);

		const mode = this.deps.settings.reviewPanelMode || "review";
		if (mode === "log") {
			this.fillLogCells(content, visibleDays, dayOffset);
		} else {
			this.fillReviewCells(content, visibleDays, dayOffset);
		}
	}

	private renderModeSwitch(spacer: HTMLElement): void {
		const mode = this.deps.settings.reviewPanelMode || "review";

		const makeLabel = (label: string, key: "review" | "log") => {
			const el = spacer.createSpan({
				cls: "weekflow-review-spacer-label weekflow-review-mode-label",
				text: label,
			});
			el.toggleClass("active", mode === key);
			el.setAttribute("role", "button");
			el.setAttribute("aria-pressed", mode === key ? "true" : "false");
			el.ariaLabel = `Switch to ${label} mode`;
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				this.setMode(key);
			});
			return el;
		};

		makeLabel("Review", "review");
		makeLabel("Log", "log");
	}

	private fillReviewCells(content: HTMLElement, visibleDays: number, dayOffset: number): void {
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

	private fillLogCells(content: HTMLElement, visibleDays: number, dayOffset: number): void {
		for (let i = 0; i < visibleDays; i++) {
			const date = this.deps.dates[dayOffset + i];
			const dateKey = date.format("YYYY-MM-DD");
			const isToday = date.isSame(window.moment(), "day");

			const cell = content.createDiv({ cls: "weekflow-review-cell weekflow-log-cell" });
			if (isToday) cell.addClass("weekflow-review-cell-today");

			const list = cell.createDiv({ cls: "weekflow-log-list" });
			const logs = this.logData.get(dateKey) || [];
			const sorted = [...logs].sort((a, b) => a.timeMinutes - b.timeMinutes);

			if (sorted.length === 0) {
				const empty = list.createDiv({ cls: "weekflow-log-empty" });
				empty.setText(isToday ? "No logs yet" : "—");
			}

			for (const log of sorted) {
				const row = list.createDiv({ cls: "weekflow-log-entry" });
				const timeEl = row.createSpan({ cls: "weekflow-log-time" });
				timeEl.setText(this.formatLogTime(log.timeMinutes));
				const textEl = row.createSpan({ cls: "weekflow-log-text" });
				textEl.setText(log.content);

				if (this.deps.onNavigateLog) {
					row.addClass("weekflow-log-entry-clickable");
					row.addEventListener("click", () => {
						this.deps.onNavigateLog!(date, log.lineNumber);
					});
				}
			}

			if (isToday) {
				const addRow = cell.createDiv({ cls: "weekflow-log-add-row" });
				const plus = addRow.createSpan({ cls: "weekflow-log-add-icon" });
				setIcon(plus, "plus");
				const input = addRow.createEl("input", {
					type: "text",
					cls: "weekflow-log-input",
					placeholder: "+ log (now)...",
				});
				input.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing && input.value.trim()) {
						e.preventDefault();
						const text = input.value.trim();
						input.value = "";
						void this.addLogNow(date, text);
					}
				});
			}
		}
	}

	private formatLogTime(timeMinutes: number): string {
		return moment()
			.startOf("day")
			.add(timeMinutes, "minutes")
			.format(this.deps.settings.logTimestampFormat || "HH:mm");
	}

	private async addLogNow(date: Moment, text: string): Promise<void> {
		const now = window.moment();
		const timeMinutes = now.hours() * 60 + now.minutes();

		// Optimistic local update so the new entry appears immediately
		const dateKey = date.format("YYYY-MM-DD");
		const existing = this.logData.get(dateKey) || [];
		const optimistic: LogItem = { timeMinutes, content: text, lineNumber: -1 };
		this.logData.set(dateKey, [...existing, optimistic]);
		this.update(this.lastVisibleDays, this.lastDayOffset);
		// Re-focus the input after re-render
		requestAnimationFrame(() => {
			const panel = this.deps.contentEl.querySelector(".weekflow-review-panel");
			if (!panel) return;
			const input = panel.querySelector(".weekflow-log-input") as HTMLInputElement | null;
			input?.focus();
		});

		await this.deps.withSelfWriteGuard(() =>
			appendDailyLog(this.deps.app.vault, date, this.deps.settings, timeMinutes, text)
		);
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
