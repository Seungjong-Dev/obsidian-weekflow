import { ItemView, type WorkspaceLeaf, type TAbstractFile, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type WeekFlowPlugin from "./main";
import { VIEW_TYPE_WEEKFLOW } from "./types";
import type { ParseWarning, TimelineItem, WeekFlowSettings } from "./types";
import { getWeekDates, getWeekNotePaths, loadWeekData, saveDailyNoteItems } from "./daily-note";
import { GridRenderer } from "./grid-renderer";
import { BlockModal } from "./block-modal";
import { EditBlockModal } from "./edit-block-modal";
import { generateItemId } from "./parser";
import { UndoManager, type UndoableAction } from "./undo-manager";

export class WeekFlowView extends ItemView {
	plugin: WeekFlowPlugin;
	private currentDate: Moment = window.moment();
	private mode: "plan" | "actual";
	private dates: Moment[] = [];
	private weekData: Map<string, TimelineItem[]> = new Map();
	private weekWarnings: Map<string, ParseWarning[]> = new Map();
	private gridRenderer: GridRenderer | null = null;
	private selectedCategory: string = "";
	private undoManager = new UndoManager();

	// Bidirectional sync state
	private isSelfWriting = false;
	private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private weekNotePaths: string[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: WeekFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.mode = plugin.settings.defaultMode;
	}

	getViewType(): string {
		return VIEW_TYPE_WEEKFLOW;
	}

	getDisplayText(): string {
		return "WeekFlow";
	}

	getIcon(): string {
		return "calendar-clock";
	}

	async onOpen() {
		// Register vault modify listener for bidirectional sync
		this.registerEvent(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				this.onFileModify(file);
			})
		);

		// Register active-leaf-change for focus-return refresh
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) {
					this.debouncedRefresh();
				}
			})
		);

		await this.refresh();
	}

	async onClose() {
		if (this.syncDebounceTimer) {
			clearTimeout(this.syncDebounceTimer);
		}
	}

	private onFileModify(file: TAbstractFile) {
		if (this.isSelfWriting) return;
		if (this.weekNotePaths.includes(file.path)) {
			this.debouncedRefresh();
		}
	}

	private debouncedRefresh() {
		if (this.syncDebounceTimer) {
			clearTimeout(this.syncDebounceTimer);
		}
		this.syncDebounceTimer = setTimeout(() => {
			this.syncDebounceTimer = null;
			this.refresh();
		}, 300);
	}

	async refresh() {
		const settings = this.plugin.settings;
		this.dates = getWeekDates(this.currentDate, settings.weekStartDay);
		this.weekNotePaths = getWeekNotePaths(this.dates, settings);
		const result = await loadWeekData(
			this.app.vault,
			this.dates,
			settings
		);
		this.weekData = result.weekData;
		this.weekWarnings = result.warnings;
		this.renderView();
	}

	private renderView() {
		const container = this.contentEl;
		container.empty();
		container.addClass("weekflow-container");

		// Toolbar
		this.renderToolbar(container);

		// Warning banner
		this.renderWarnings(container);

		// Grid wrapper
		const gridWrapper = container.createDiv({ cls: "weekflow-grid-wrapper" });

		// Detect overlapping items per day
		const overlapIds = this.detectOverlaps();

		this.gridRenderer = new GridRenderer(
			gridWrapper,
			this.plugin.settings,
			this.dates,
			this.weekData,
			this.mode,
			{
				onCellDragStart: () => {},
				onCellDragMove: () => {},
				onCellDragEnd: () => this.onDragEnd(),
				onBlockClick: (dayIndex, item) =>
					this.onBlockClick(dayIndex, item),
				onBlockDragEnd: (item, fromDay, toDay, newStart) =>
					this.onBlockDragEnd(item, fromDay, toDay, newStart),
				onBlockResize: (item, dayIndex, newStart, newEnd) =>
					this.onBlockResize(item, dayIndex, newStart, newEnd),
			},
			overlapIds
		);
		this.gridRenderer.render();
		this.applyModeToGrid();
	}

	private renderWarnings(container: HTMLElement) {
		const allWarnings: { date: string; warning: ParseWarning }[] = [];
		for (const [date, warnings] of this.weekWarnings) {
			for (const w of warnings) {
				allWarnings.push({ date, warning: w });
			}
		}
		if (allWarnings.length === 0) return;

		const banner = container.createDiv({ cls: "weekflow-warning-banner" });
		const header = banner.createDiv({ cls: "weekflow-warning-header" });
		header.setText(`${allWarnings.length} parse warning(s)`);

		const list = banner.createEl("ul", { cls: "weekflow-warning-list" });
		for (const { date, warning } of allWarnings) {
			const li = list.createEl("li");
			li.setText(`${date} line ${warning.line}: ${warning.message}`);
		}
	}

	private detectOverlaps(): Set<string> {
		const overlapIds = new Set<string>();

		for (const [, items] of this.weekData) {
			for (let i = 0; i < items.length; i++) {
				for (let j = i + 1; j < items.length; j++) {
					const a = items[i];
					const b = items[j];
					const aTime = a.checkbox === "actual" && a.actualTime ? a.actualTime : a.planTime;
					const bTime = b.checkbox === "actual" && b.actualTime ? b.actualTime : b.planTime;

					if (aTime.start < bTime.end && bTime.start < aTime.end) {
						overlapIds.add(a.id);
						overlapIds.add(b.id);
					}
				}
			}
		}

		return overlapIds;
	}

	private applyModeToGrid() {
		const container = this.contentEl;
		container.removeClass("weekflow-mode-plan", "weekflow-mode-actual");
		container.addClass(`weekflow-mode-${this.mode}`);
	}

	private renderToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "weekflow-toolbar" });

		// Navigation
		const nav = toolbar.createDiv({ cls: "weekflow-toolbar-nav" });

		const prevBtn = nav.createEl("button", { text: "\u25C0" });
		prevBtn.addEventListener("click", () => this.navigateWeek(-1));

		const weekLabel = nav.createSpan({ cls: "weekflow-week-label" });
		const weekNum = this.dates[0].format("[W]ww, YYYY");
		weekLabel.setText(weekNum);

		const nextBtn = nav.createEl("button", { text: "\u25B6" });
		nextBtn.addEventListener("click", () => this.navigateWeek(1));

		const todayBtn = nav.createEl("button", { text: "Today" });
		todayBtn.addEventListener("click", () => {
			this.currentDate = window.moment();
			this.refresh();
		});

		const refreshBtn = nav.createEl("button", { text: "\u21BB" });
		refreshBtn.ariaLabel = "Refresh";
		refreshBtn.addEventListener("click", () => this.refresh());

		// Undo/Redo buttons
		const undoBtn = nav.createEl("button", { text: "\u21A9" });
		undoBtn.ariaLabel = "Undo";
		if (!this.undoManager.canUndo()) undoBtn.addClass("weekflow-btn-disabled");
		undoBtn.addEventListener("click", () => this.undo());

		const redoBtn = nav.createEl("button", { text: "\u21AA" });
		redoBtn.ariaLabel = "Redo";
		if (!this.undoManager.canRedo()) redoBtn.addClass("weekflow-btn-disabled");
		redoBtn.addEventListener("click", () => this.redo());

		// Category palette
		const palette = toolbar.createDiv({ cls: "weekflow-palette" });
		for (const cat of this.plugin.settings.categories) {
			const btn = palette.createEl("button", {
				cls: "weekflow-palette-btn",
			});
			const dot = btn.createSpan({ cls: "weekflow-palette-dot" });
			dot.style.backgroundColor = cat.color;
			btn.createSpan({ text: cat.label || cat.tag });

			if (this.selectedCategory === cat.tag) {
				btn.addClass("active");
			}

			btn.addEventListener("click", () => {
				this.selectedCategory = cat.tag;
				palette.querySelectorAll(".weekflow-palette-btn").forEach((b) =>
					b.removeClass("active")
				);
				btn.addClass("active");
			});
		}

		// Mode toggle
		const modeToggle = toolbar.createDiv({ cls: "weekflow-mode-toggle" });

		const planBtn = modeToggle.createEl("button", {
			text: "Plan",
			cls: "weekflow-mode-btn",
		});
		const actualBtn = modeToggle.createEl("button", {
			text: "Actual",
			cls: "weekflow-mode-btn",
		});

		if (this.mode === "plan") planBtn.addClass("active");
		else actualBtn.addClass("active");

		planBtn.addEventListener("click", () => {
			this.mode = "plan";
			planBtn.addClass("active");
			actualBtn.removeClass("active");
			this.applyModeToGrid();
		});

		actualBtn.addEventListener("click", () => {
			this.mode = "actual";
			actualBtn.addClass("active");
			planBtn.removeClass("active");
			this.applyModeToGrid();
		});
	}

	private async navigateWeek(delta: number) {
		this.currentDate = this.currentDate
			.clone()
			.add(delta * 7, "days");
		await this.refresh();
	}

	// ── Save helper with self-writing guard ──

	private async guardedSave(date: Moment, items: TimelineItem[]) {
		this.isSelfWriting = true;
		try {
			await saveDailyNoteItems(
				this.app.vault,
				date,
				this.plugin.settings,
				items
			);
		} finally {
			this.isSelfWriting = false;
		}
	}

	// ── Undo/Redo ──

	async undo() {
		if (!this.undoManager.canUndo()) return;
		this.isSelfWriting = true;
		try {
			await this.undoManager.undo();
		} finally {
			this.isSelfWriting = false;
		}
		await this.refresh();
	}

	async redo() {
		if (!this.undoManager.canRedo()) return;
		this.isSelfWriting = true;
		try {
			await this.undoManager.redo();
		} finally {
			this.isSelfWriting = false;
		}
		await this.refresh();
	}

	// ── Block Creation (cell drag) ──

	private async onDragEnd() {
		if (!this.gridRenderer) return;

		const selection = this.gridRenderer.getSelection();
		if (!selection) return;

		const planTime = {
			start: selection.startMinutes,
			end: selection.endMinutes,
		};

		new BlockModal(
			this.app,
			planTime,
			this.mode,
			this.plugin.settings.categories,
			async (result) => {
				const checkbox = this.mode === "plan" ? "plan" : "actual";
				const newItem: TimelineItem = {
					id: generateItemId(),
					checkbox: checkbox,
					planTime,
					content: result.content,
					tags: result.tag ? [result.tag] : [],
					rawSuffix: "",
				};

				if (this.mode === "actual") {
					newItem.checkbox = "actual";
				}

				const dayIndex = selection.dayIndex;
				const date = this.dates[dayIndex];
				const dateKey = date.format("YYYY-MM-DD");

				// Check for overnight split
				const splitResult = this.splitOvernightItem(newItem, dayIndex);
				if (splitResult) {
					// Save today portion
					const todayItems = [...(this.weekData.get(splitResult.todayKey) || []), splitResult.today];
					this.weekData.set(splitResult.todayKey, todayItems);
					await this.guardedSave(this.dates[splitResult.todayDayIndex], todayItems);

					// Save tomorrow portion
					const tomorrowItems = [...(this.weekData.get(splitResult.tomorrowKey) || []), splitResult.tomorrow];
					this.weekData.set(splitResult.tomorrowKey, tomorrowItems);
					await this.guardedSave(this.dates[splitResult.tomorrowDayIndex], tomorrowItems);

					// Undo action
					const action: UndoableAction = {
						description: "Create overnight block",
						execute: async () => { /* already executed */ },
						undo: async () => {
							const ti = this.weekData.get(splitResult.todayKey) || [];
							this.weekData.set(splitResult.todayKey, ti.filter(i => i.id !== splitResult.today.id));
							await this.guardedSave(this.dates[splitResult.todayDayIndex], this.weekData.get(splitResult.todayKey)!);

							const tmr = this.weekData.get(splitResult.tomorrowKey) || [];
							this.weekData.set(splitResult.tomorrowKey, tmr.filter(i => i.id !== splitResult.tomorrow.id));
							await this.guardedSave(this.dates[splitResult.tomorrowDayIndex], this.weekData.get(splitResult.tomorrowKey)!);
						},
					};
					this.undoManager.pushExecuted(action);
				} else {
					const existing = this.weekData.get(dateKey) || [];
					existing.push(newItem);
					this.weekData.set(dateKey, existing);

					await this.guardedSave(date, existing);

					// Undo action
					const action: UndoableAction = {
						description: "Create block",
						execute: async () => { /* already executed */ },
						undo: async () => {
							const items = this.weekData.get(dateKey) || [];
							this.weekData.set(dateKey, items.filter(i => i.id !== newItem.id));
							await this.guardedSave(date, this.weekData.get(dateKey)!);
						},
					};
					this.undoManager.pushExecuted(action);
				}

				this.gridRenderer?.clearSelection();
				await this.refresh();
			}
		).open();
	}

	// ── Block Click → Edit Modal ──

	private onBlockClick(dayIndex: number, item: TimelineItem) {
		const date = this.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");

		new EditBlockModal(
			this.app,
			item,
			this.plugin.settings.categories,
			async (result) => {
				if (result.action === "delete") {
					const items = this.weekData.get(dateKey) || [];
					const oldItem = { ...item, planTime: { ...item.planTime }, actualTime: item.actualTime ? { ...item.actualTime } : undefined, tags: [...item.tags] };
					this.weekData.set(dateKey, items.filter(i => i.id !== item.id));

					await this.guardedSave(date, this.weekData.get(dateKey)!);

					const action: UndoableAction = {
						description: "Delete block",
						execute: async () => { /* already executed */ },
						undo: async () => {
							const items = this.weekData.get(dateKey) || [];
							items.push(oldItem);
							this.weekData.set(dateKey, items);
							await this.guardedSave(date, items);
						},
					};
					this.undoManager.pushExecuted(action);
				} else {
					// Edit
					const items = this.weekData.get(dateKey) || [];
					const idx = items.findIndex(i => i.id === item.id);
					if (idx === -1) return;

					const oldItem = { ...items[idx], planTime: { ...items[idx].planTime }, actualTime: items[idx].actualTime ? { ...items[idx].actualTime } : undefined, tags: [...items[idx].tags] };

					items[idx].content = result.content;
					items[idx].tags = result.tag ? [result.tag] : [];
					items[idx].planTime = { start: result.startMinutes, end: result.endMinutes };

					await this.guardedSave(date, items);

					const action: UndoableAction = {
						description: "Edit block",
						execute: async () => { /* already executed */ },
						undo: async () => {
							const items = this.weekData.get(dateKey) || [];
							const idx = items.findIndex(i => i.id === oldItem.id);
							if (idx !== -1) {
								items[idx] = oldItem;
								await this.guardedSave(date, items);
							}
						},
					};
					this.undoManager.pushExecuted(action);
				}

				await this.refresh();
			}
		).open();
	}

	// ── Block Drag Move ──

	private async onBlockDragEnd(
		item: TimelineItem,
		fromDay: number,
		toDay: number,
		newStart: number
	) {
		const duration = item.planTime.end - item.planTime.start;
		const newEnd = newStart + duration;
		const fromDate = this.dates[fromDay];
		const fromKey = fromDate.format("YYYY-MM-DD");
		const toDate = this.dates[toDay];
		const toKey = toDate.format("YYYY-MM-DD");

		const oldStart = item.planTime.start;
		const oldEnd = item.planTime.end;

		if (fromDay === toDay) {
			// Same-day move
			const items = this.weekData.get(fromKey) || [];
			const idx = items.findIndex(i => i.id === item.id);
			if (idx === -1) return;

			items[idx].planTime = { start: newStart, end: newEnd };
			if (items[idx].actualTime) {
				const actDuration = items[idx].actualTime!.end - items[idx].actualTime!.start;
				items[idx].actualTime = { start: newStart, end: newStart + actDuration };
			}

			await this.guardedSave(fromDate, items);

			const action: UndoableAction = {
				description: "Move block",
				execute: async () => { /* already executed */ },
				undo: async () => {
					const items = this.weekData.get(fromKey) || [];
					const idx = items.findIndex(i => i.id === item.id);
					if (idx !== -1) {
						items[idx].planTime = { start: oldStart, end: oldEnd };
						if (items[idx].actualTime) {
							const actDuration = items[idx].actualTime!.end - items[idx].actualTime!.start;
							items[idx].actualTime = { start: oldStart, end: oldStart + actDuration };
						}
						await this.guardedSave(fromDate, items);
					}
				},
			};
			this.undoManager.pushExecuted(action);
		} else {
			// Cross-day move
			const fromItems = this.weekData.get(fromKey) || [];
			const movedItem = fromItems.find(i => i.id === item.id);
			if (!movedItem) return;

			// Remove from original day
			this.weekData.set(fromKey, fromItems.filter(i => i.id !== item.id));

			// Update times and add to new day
			movedItem.planTime = { start: newStart, end: newEnd };
			if (movedItem.actualTime) {
				const actDuration = movedItem.actualTime.end - movedItem.actualTime.start;
				movedItem.actualTime = { start: newStart, end: newStart + actDuration };
			}

			const toItems = this.weekData.get(toKey) || [];
			toItems.push(movedItem);
			this.weekData.set(toKey, toItems);

			await this.guardedSave(fromDate, this.weekData.get(fromKey)!);
			await this.guardedSave(toDate, toItems);

			const action: UndoableAction = {
				description: "Move block to another day",
				execute: async () => { /* already executed */ },
				undo: async () => {
					// Move back
					const toItems = this.weekData.get(toKey) || [];
					const itemBack = toItems.find(i => i.id === item.id);
					if (!itemBack) return;

					this.weekData.set(toKey, toItems.filter(i => i.id !== item.id));
					itemBack.planTime = { start: oldStart, end: oldEnd };
					if (itemBack.actualTime) {
						const actDuration = itemBack.actualTime.end - itemBack.actualTime.start;
						itemBack.actualTime = { start: oldStart, end: oldStart + actDuration };
					}

					const fromItems = this.weekData.get(fromKey) || [];
					fromItems.push(itemBack);
					this.weekData.set(fromKey, fromItems);

					await this.guardedSave(toDate, this.weekData.get(toKey)!);
					await this.guardedSave(fromDate, fromItems);
				},
			};
			this.undoManager.pushExecuted(action);
		}

		await this.refresh();
	}

	// ── Block Resize ──

	private async onBlockResize(
		item: TimelineItem,
		dayIndex: number,
		newStart: number,
		newEnd: number
	) {
		const date = this.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const items = this.weekData.get(dateKey) || [];
		const idx = items.findIndex(i => i.id === item.id);
		if (idx === -1) return;

		const oldStart = items[idx].planTime.start;
		const oldEnd = items[idx].planTime.end;

		items[idx].planTime = { start: newStart, end: newEnd };

		await this.guardedSave(date, items);

		const action: UndoableAction = {
			description: "Resize block",
			execute: async () => { /* already executed */ },
			undo: async () => {
				const items = this.weekData.get(dateKey) || [];
				const idx = items.findIndex(i => i.id === item.id);
				if (idx !== -1) {
					items[idx].planTime = { start: oldStart, end: oldEnd };
					await this.guardedSave(date, items);
				}
			},
		};
		this.undoManager.pushExecuted(action);

		await this.refresh();
	}

	// ── Overnight Split Helper ──

	private splitOvernightItem(
		item: TimelineItem,
		dayIndex: number
	): {
		today: TimelineItem;
		tomorrow: TimelineItem;
		todayKey: string;
		tomorrowKey: string;
		todayDayIndex: number;
		tomorrowDayIndex: number;
	} | null {
		const dayEndMin = this.plugin.settings.dayEndHour * 60;
		if (item.planTime.end <= dayEndMin) return null;
		if (dayIndex >= 6) return null; // Can't split past last day of week

		const todayDayIndex = dayIndex;
		const tomorrowDayIndex = dayIndex + 1;
		const todayKey = this.dates[todayDayIndex].format("YYYY-MM-DD");
		const tomorrowKey = this.dates[tomorrowDayIndex].format("YYYY-MM-DD");

		const today: TimelineItem = {
			...item,
			id: generateItemId(),
			planTime: { start: item.planTime.start, end: dayEndMin },
		};

		const overflowMinutes = item.planTime.end - dayEndMin;
		const tomorrowStart = this.plugin.settings.dayStartHour * 60;
		const tomorrow: TimelineItem = {
			...item,
			id: generateItemId(),
			tags: [...item.tags],
			planTime: { start: tomorrowStart, end: tomorrowStart + overflowMinutes },
		};

		return { today, tomorrow, todayKey, tomorrowKey, todayDayIndex, tomorrowDayIndex };
	}

	// Persist/restore view state
	getState(): Record<string, unknown> {
		return {
			currentDate: this.currentDate.format("YYYY-MM-DD"),
			mode: this.mode,
		};
	}

	async setState(state: any, result: { history: boolean }): Promise<void> {
		if (typeof state.currentDate === "string") {
			this.currentDate = window.moment(state.currentDate, "YYYY-MM-DD");
		}
		if (state.mode === "plan" || state.mode === "actual") {
			this.mode = state.mode;
		}
		await this.refresh();
	}
}
