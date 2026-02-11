import { ItemView, setIcon, type WorkspaceLeaf, type TAbstractFile, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type WeekFlowPlugin from "./main";
import { VIEW_TYPE_WEEKFLOW } from "./types";
import type { PanelItem, ParseWarning, TimelineItem, WeekFlowSettings } from "./types";
import { getWeekDates, getWeekNotePaths, loadWeekData, saveDailyNoteItems, resolveInboxNotePath, getInboxItems, addToInbox, getActiveProjects, getProjectTasks, appendBlockIdToLine, completeProjectTask } from "./daily-note";
import type { ProjectInfo } from "./daily-note";
import { GridRenderer } from "./grid-renderer";
import { BlockModal } from "./block-modal";
import { EditBlockModal } from "./edit-block-modal";
import { ConfirmModal } from "./confirm-modal";
import { PresetModal, ApplyPresetModal, CreatePresetModal } from "./preset-modal";
import { generateItemId, serializeCheckboxItem, extractBlockId, generateBlockId, formatTime } from "./parser";
import { UndoManager, type UndoableAction } from "./undo-manager";
import { PlanningPanel, type PanelSection } from "./planning-panel";
import type { CheckboxItem } from "./parser";

export class WeekFlowView extends ItemView {
	plugin: WeekFlowPlugin;
	private currentDate: Moment = window.moment();
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

	// Planning panel
	private planningPanel: PlanningPanel | null = null;
	private panelSections: PanelSection[] = [];
	private inboxItems: CheckboxItem[] = [];
	private projectData: { project: ProjectInfo; tasks: CheckboxItem[] }[] = [];

	// Panel drag state
	private panelDragItem: PanelItem | null = null;
	private boundPanelDragMove: ((e: MouseEvent) => void) | null = null;
	private boundPanelDragUp: ((e: MouseEvent) => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WeekFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
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

		// Add inbox note path to watched files
		const inboxPath = resolveInboxNotePath(settings.inboxNotePath);
		if (!this.weekNotePaths.includes(inboxPath)) {
			this.weekNotePaths.push(inboxPath);
		}

		// Load week data and inbox
		const [result, inbox] = await Promise.all([
			loadWeekData(this.app.vault, this.dates, settings),
			getInboxItems(this.app.vault, settings),
		]);
		this.weekData = result.weekData;
		this.weekWarnings = result.warnings;
		this.inboxItems = inbox;

		// Load project data (non-blocking — failure should not prevent rendering)
		try {
			const projects = getActiveProjects(this.app, settings);
			const projectTaskResults = await Promise.all(
				projects.map((p) =>
					getProjectTasks(this.app.vault, p.path, settings.projectTasksHeading)
				)
			);
			this.projectData = projects.map((p, i) => ({
				project: p,
				tasks: projectTaskResults[i],
			}));
		} catch (e) {
			console.error("WeekFlow: failed to load project data", e);
			this.projectData = [];
		}

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

		// Body: panel + grid
		const body = container.createDiv({ cls: "weekflow-body" });

		// Planning panel
		const panelEl = body.createDiv({ cls: "weekflow-panel" });
		if (!this.plugin.settings.planningPanelOpen) {
			panelEl.addClass("collapsed");
		}
		this.planningPanel = new PlanningPanel(panelEl, {
			onItemDragStart: (item, e) => this.onPanelDragStart(item, e),
		});
		this.buildPanelSections();
		this.planningPanel.render(this.panelSections);

		// Grid wrapper
		const gridWrapper = body.createDiv({ cls: "weekflow-grid-wrapper" });

		// Detect overlapping items per day
		const overlapIds = this.detectOverlaps();

		this.gridRenderer = new GridRenderer(
			gridWrapper,
			this.plugin.settings,
			this.dates,
			this.weekData,
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
				onBlockDropOutside: (item, fromDay) =>
					this.onBlockReturnToInbox(item, fromDay),
				onBlockComplete: (dayIndex, item) =>
					this.onBlockComplete(dayIndex, item),
				onBlockUncomplete: (dayIndex, item) =>
					this.onBlockUncomplete(dayIndex, item),
			},
			overlapIds
		);
		this.gridRenderer.render();
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


	private renderToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "weekflow-toolbar" });

		// Navigation
		const nav = toolbar.createDiv({ cls: "weekflow-toolbar-nav" });

		// Panel toggle button
		const panelToggleBtn = nav.createEl("button");
		setIcon(panelToggleBtn, "layout-sidebar-left");
		panelToggleBtn.ariaLabel = "Toggle planning panel";
		if (this.plugin.settings.planningPanelOpen) panelToggleBtn.addClass("active");
		panelToggleBtn.addEventListener("click", () => this.togglePanel());

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

		// Sort button
		const sortBtn = nav.createEl("button");
		setIcon(sortBtn, "arrow-up-narrow-wide");
		sortBtn.ariaLabel = "Compact plan blocks";
		sortBtn.addEventListener("click", () => this.sortBlocksCompact());

		// Preset dropdown
		const presetBtn = nav.createEl("button");
		setIcon(presetBtn, "clock");
		presetBtn.ariaLabel = "Presets";
		presetBtn.addEventListener("click", (e) =>
			this.showPresetMenu(e)
		);

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

		const dayIndex = selection.dayIndex;
		const targetDate = this.dates[dayIndex];
		const today = window.moment().startOf("day");
		const isPast = targetDate.isBefore(today, "day");

		// Past dates → actual, today/future → plan
		const effectiveMode = isPast ? "actual" : "plan";

		new BlockModal(
			this.app,
			planTime,
			effectiveMode,
			this.plugin.settings.categories,
			async (result) => {
				const checkbox = effectiveMode === "actual" ? "actual" : "plan";
				const newItem: TimelineItem = {
					id: generateItemId(),
					checkbox: checkbox,
					planTime,
					content: result.content,
					tags: result.tag ? [result.tag] : [],
					rawSuffix: "",
				};

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
					if (result.actualStartMinutes != null && result.actualEndMinutes != null) {
						items[idx].actualTime = { start: result.actualStartMinutes, end: result.actualEndMinutes };
					}

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
		const dragTime = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
		const duration = dragTime.end - dragTime.start;
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

			if (items[idx].checkbox === "actual") {
				// Actual block: move actualTime only, preserve planTime
				const oldActualTime = items[idx].actualTime ? { ...items[idx].actualTime! } : undefined;
				items[idx].actualTime = { start: newStart, end: newEnd };

				await this.guardedSave(fromDate, items);

				const action: UndoableAction = {
					description: "Move actual block",
					execute: async () => { /* already executed */ },
					undo: async () => {
						const items = this.weekData.get(fromKey) || [];
						const idx = items.findIndex(i => i.id === item.id);
						if (idx !== -1) {
							items[idx].actualTime = oldActualTime;
							await this.guardedSave(fromDate, items);
						}
					},
				};
				this.undoManager.pushExecuted(action);
			} else {
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
			}
		} else {
			// Cross-day move
			const today = window.moment().startOf("day");
			const isPastDay = fromDate.isBefore(today, "day");

			const fromItems = this.weekData.get(fromKey) || [];
			const movedItem = fromItems.find(i => i.id === item.id);
			if (!movedItem) return;

			const oldCheckbox = movedItem.checkbox;

			if (isPastDay && movedItem.checkbox === "plan") {
				// Deferred logic: mark original as deferred, create new plan on target day
				movedItem.checkbox = "deferred";
				await this.guardedSave(fromDate, fromItems);

				const newItem: TimelineItem = {
					id: generateItemId(),
					checkbox: "plan",
					planTime: { start: newStart, end: newEnd },
					content: movedItem.content,
					tags: [...movedItem.tags],
					rawSuffix: movedItem.rawSuffix,
				};

				const toItems = this.weekData.get(toKey) || [];
				toItems.push(newItem);
				this.weekData.set(toKey, toItems);
				await this.guardedSave(toDate, toItems);

				const action: UndoableAction = {
					description: "Defer block to another day",
					execute: async () => { /* already executed */ },
					undo: async () => {
						// Restore original checkbox
						const fi = this.weekData.get(fromKey) || [];
						const idx = fi.findIndex(i => i.id === item.id);
						if (idx !== -1) {
							fi[idx].checkbox = oldCheckbox;
							await this.guardedSave(fromDate, fi);
						}
						// Remove new item from target day
						const ti = this.weekData.get(toKey) || [];
						this.weekData.set(toKey, ti.filter(i => i.id !== newItem.id));
						await this.guardedSave(toDate, this.weekData.get(toKey)!);
					},
				};
				this.undoManager.pushExecuted(action);
			} else {
				// Simple move: remove from original day, add to new day
				this.weekData.set(fromKey, fromItems.filter(i => i.id !== item.id));

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

		if (items[idx].checkbox === "actual") {
			// Actual block: change actualTime, preserve planTime
			const oldActualTime = items[idx].actualTime ? { ...items[idx].actualTime! } : undefined;
			items[idx].actualTime = { start: newStart, end: newEnd };

			await this.guardedSave(date, items);

			const action: UndoableAction = {
				description: "Resize actual block",
				execute: async () => { /* already executed */ },
				undo: async () => {
					const items = this.weekData.get(dateKey) || [];
					const idx = items.findIndex(i => i.id === item.id);
					if (idx !== -1) {
						items[idx].actualTime = oldActualTime;
						await this.guardedSave(date, items);
					}
				},
			};
			this.undoManager.pushExecuted(action);
		} else {
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
		}

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

	// ── Planning Panel ──

	togglePlanningPanel() {
		this.togglePanel();
	}

	private togglePanel() {
		this.plugin.settings.planningPanelOpen = !this.plugin.settings.planningPanelOpen;
		this.plugin.saveSettings();
		const panelEl = this.contentEl.querySelector(".weekflow-panel") as HTMLElement | null;
		if (panelEl) {
			panelEl.toggleClass("collapsed", !this.plugin.settings.planningPanelOpen);
		}
	}

	private buildPanelSections(): void {
		this.panelSections = [
			{
				type: "overdue",
				title: "Overdue",
				icon: "alert-triangle",
				items: this.collectOverdueItems(),
				collapsed: false,
			},
			{
				type: "inbox",
				title: "Inbox",
				icon: "inbox",
				items: this.collectInboxPanelItems(),
				collapsed: false,
			},
			...this.collectProjectSections(),
		];
	}

	private collectProjectSections(): PanelSection[] {
		return this.projectData.map(({ project, tasks }) => ({
			type: "project" as const,
			title: project.title,
			icon: "folder",
			key: `project:${project.path}`,
			items: tasks.map((task) => ({
				id: generateItemId(),
				content: task.content,
				tags: [...task.tags],
				rawSuffix: task.rawSuffix,
				source: {
					type: "project" as const,
					projectPath: project.path,
					blockId: this.extractBlockIdFromRaw(task),
				},
			})),
			collapsed: false,
		}));
	}

	private extractBlockIdFromRaw(task: CheckboxItem): string | undefined {
		// Reconstruct the raw line and extract block ID
		const parts = [task.content];
		for (const tag of task.tags) parts.push(`#${tag}`);
		if (task.rawSuffix) parts.push(task.rawSuffix);
		const line = `- [ ] ${parts.join(" ")}`;
		return extractBlockId(line);
	}

	private collectOverdueItems(): PanelItem[] {
		const today = window.moment().startOf("day");
		const items: PanelItem[] = [];
		for (let i = 0; i < 7; i++) {
			if (this.dates[i].isSameOrAfter(today, "day")) continue;
			const dateKey = this.dates[i].format("YYYY-MM-DD");
			for (const item of (this.weekData.get(dateKey) || [])) {
				if (item.checkbox !== "plan") continue;
				items.push({
					id: generateItemId(),
					content: item.content,
					tags: [...item.tags],
					rawSuffix: item.rawSuffix,
					source: {
						type: "overdue",
						dateKey,
						planTime: { ...item.planTime },
						originalId: item.id,
					},
				});
			}
		}
		return items;
	}

	private collectInboxPanelItems(): PanelItem[] {
		const inboxPath = resolveInboxNotePath(this.plugin.settings.inboxNotePath);
		return this.inboxItems.map((ci) => ({
			id: generateItemId(),
			content: ci.content,
			tags: [...ci.tags],
			rawSuffix: ci.rawSuffix,
			source: {
				type: "inbox" as const,
				notePath: inboxPath,
				lineNumber: ci.lineNumber,
			},
		}));
	}

	// ── Panel Drag → Grid ──

	private onPanelDragStart(item: PanelItem, e: MouseEvent): void {
		this.panelDragItem = item;

		this.boundPanelDragMove = (ev: MouseEvent) => this.onPanelDragMove(ev);
		this.boundPanelDragUp = (ev: MouseEvent) => this.onPanelDragEnd(ev);
		document.addEventListener("mousemove", this.boundPanelDragMove);
		document.addEventListener("mouseup", this.boundPanelDragUp);
	}

	private onPanelDragMove(e: MouseEvent): void {
		if (!this.panelDragItem || !this.gridRenderer) return;

		const cell = this.gridRenderer.getGridCellFromPoint(e.clientX, e.clientY);
		if (cell) {
			const src = this.panelDragItem.source;
			const duration = src.type === "overdue"
				? (src.planTime.end - src.planTime.start)
				: this.plugin.settings.defaultBlockDuration;
			const color = this.getCategoryColorForTags(this.panelDragItem.tags);
			this.gridRenderer.renderExternalGhost(
				cell.dayIndex,
				cell.minutes,
				cell.minutes + duration,
				color,
				this.panelDragItem.content
			);
		} else {
			this.gridRenderer.removeExternalGhost();
		}
	}

	private async onPanelDragEnd(e: MouseEvent): Promise<void> {
		this.cleanupPanelDrag();

		if (!this.panelDragItem || !this.gridRenderer) {
			this.panelDragItem = null;
			return;
		}

		const cell = this.gridRenderer.getGridCellFromPoint(e.clientX, e.clientY);
		this.gridRenderer.removeExternalGhost();

		if (!cell) {
			this.panelDragItem = null;
			return;
		}

		const item = this.panelDragItem;
		this.panelDragItem = null;

		const src = item.source;
		const duration = src.type === "overdue"
			? (src.planTime.end - src.planTime.start)
			: this.plugin.settings.defaultBlockDuration;

		const snappedStart = Math.round(cell.minutes / 10) * 10;
		const snappedEnd = snappedStart + duration;

		const date = this.dates[cell.dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const today = window.moment().startOf("day");
		const isPast = date.isBefore(today, "day");

		// For project source: ensure block ID and create linked content
		let contentForTimeline = item.content;
		if (src.type === "project") {
			let blockId = src.blockId;
			if (!blockId) {
				// Auto-assign block ID to project note line
				blockId = generateBlockId();
				// Find the matching task's line number
				const pd = this.projectData.find(
					(d) => d.project.path === src.projectPath
				);
				if (pd) {
					const taskIdx = pd.tasks.findIndex(
						(t) => t.content === item.content
					);
					if (taskIdx !== -1) {
						this.isSelfWriting = true;
						try {
							await appendBlockIdToLine(
								this.app.vault,
								src.projectPath,
								pd.tasks[taskIdx].lineNumber,
								blockId
							);
						} finally {
							this.isSelfWriting = false;
						}
					}
				}
			}
			// Build the project link for the timeline item
			const projectFile = this.app.vault.getAbstractFileByPath(src.projectPath);
			const projectName = projectFile
				? projectFile.name.replace(/\.md$/, "")
				: src.projectPath.replace(/\.md$/, "");
			contentForTimeline = `${item.content} [[${projectName}#^${blockId}]]`;
		}

		const newItem: TimelineItem = {
			id: generateItemId(),
			checkbox: isPast ? "actual" : "plan",
			planTime: { start: snappedStart, end: snappedEnd },
			content: contentForTimeline,
			tags: [...item.tags],
			rawSuffix: item.rawSuffix,
		};

		const existing = this.weekData.get(dateKey) || [];
		existing.push(newItem);
		this.weekData.set(dateKey, existing);

		await this.guardedSave(date, existing);

		// Handle source-specific side effects
		if (src.type === "overdue") {
			// Mark original as deferred
			const origDate = this.dates.find(d => d.format("YYYY-MM-DD") === src.dateKey);
			if (origDate) {
				const origItems = this.weekData.get(src.dateKey) || [];
				const origIdx = origItems.findIndex(i => i.id === src.originalId);
				if (origIdx !== -1) {
					const oldCheckbox = origItems[origIdx].checkbox;
					origItems[origIdx].checkbox = "deferred";
					await this.guardedSave(origDate, origItems);

					const action: UndoableAction = {
						description: "Schedule overdue item",
						execute: async () => { /* already executed */ },
						undo: async () => {
							// Restore original
							const oi = this.weekData.get(src.dateKey) || [];
							const idx = oi.findIndex(i => i.id === src.originalId);
							if (idx !== -1) {
								oi[idx].checkbox = oldCheckbox;
								await this.guardedSave(origDate, oi);
							}
							// Remove new block
							const ni = this.weekData.get(dateKey) || [];
							this.weekData.set(dateKey, ni.filter(i => i.id !== newItem.id));
							await this.guardedSave(date, this.weekData.get(dateKey)!);
						},
					};
					this.undoManager.pushExecuted(action);
				}
			}
		} else if (src.type === "inbox") {
			// Remove from inbox note
			const inboxLine = serializeCheckboxItem(item.content, item.tags, item.rawSuffix);
			await this.removeFromInbox(src.lineNumber);

			const action: UndoableAction = {
				description: "Schedule inbox item",
				execute: async () => { /* already executed */ },
				undo: async () => {
					// Remove new block
					const ni = this.weekData.get(dateKey) || [];
					this.weekData.set(dateKey, ni.filter(i => i.id !== newItem.id));
					await this.guardedSave(date, this.weekData.get(dateKey)!);
					// Re-add to inbox
					await addToInbox(this.app.vault, this.plugin.settings, inboxLine);
				},
			};
			this.undoManager.pushExecuted(action);
		} else {
			// Project source: don't remove from panel (copy model)
			const action: UndoableAction = {
				description: "Schedule project task",
				execute: async () => { /* already executed */ },
				undo: async () => {
					const ni = this.weekData.get(dateKey) || [];
					this.weekData.set(dateKey, ni.filter(i => i.id !== newItem.id));
					await this.guardedSave(date, this.weekData.get(dateKey)!);
				},
			};
			this.undoManager.pushExecuted(action);
		}

		await this.refresh();
	}

	private cleanupPanelDrag(): void {
		if (this.boundPanelDragMove) {
			document.removeEventListener("mousemove", this.boundPanelDragMove);
			this.boundPanelDragMove = null;
		}
		if (this.boundPanelDragUp) {
			document.removeEventListener("mouseup", this.boundPanelDragUp);
			this.boundPanelDragUp = null;
		}
	}

	private async removeFromInbox(lineNumber: number): Promise<void> {
		const path = resolveInboxNotePath(this.plugin.settings.inboxNotePath);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !("extension" in file)) return;

		this.isSelfWriting = true;
		try {
			const content = await this.app.vault.read(file as any);
			const lines = content.split("\n");
			if (lineNumber >= 0 && lineNumber < lines.length) {
				lines.splice(lineNumber, 1);
				await this.app.vault.modify(file as any, lines.join("\n"));
			}
		} finally {
			this.isSelfWriting = false;
		}
	}

	// ── Block Return to Inbox ──

	private async onBlockReturnToInbox(item: TimelineItem, fromDay: number): Promise<void> {
		const fromDate = this.dates[fromDay];
		const fromKey = fromDate.format("YYYY-MM-DD");
		const today = window.moment().startOf("day");

		// Serialize as inbox checkbox line
		const inboxLine = serializeCheckboxItem(item.content, item.tags, item.rawSuffix);

		// Add to inbox
		this.isSelfWriting = true;
		try {
			await addToInbox(this.app.vault, this.plugin.settings, inboxLine);
		} finally {
			this.isSelfWriting = false;
		}

		const fromItems = this.weekData.get(fromKey) || [];
		const oldCheckbox = item.checkbox;

		if (fromDate.isBefore(today, "day")) {
			// Past day: mark as deferred
			const idx = fromItems.findIndex(i => i.id === item.id);
			if (idx !== -1) {
				fromItems[idx].checkbox = "deferred";
				await this.guardedSave(fromDate, fromItems);
			}
		} else {
			// Today or future: delete
			this.weekData.set(fromKey, fromItems.filter(i => i.id !== item.id));
			await this.guardedSave(fromDate, this.weekData.get(fromKey)!);
		}

		// Undo
		const action: UndoableAction = {
			description: "Return block to inbox",
			execute: async () => { /* already executed */ },
			undo: async () => {
				// TODO: Remove from inbox (would need to track the line)
				// Restore block
				const fi = this.weekData.get(fromKey) || [];
				if (fromDate.isBefore(today, "day")) {
					const idx = fi.findIndex(i => i.id === item.id);
					if (idx !== -1) {
						fi[idx].checkbox = oldCheckbox;
						await this.guardedSave(fromDate, fi);
					}
				} else {
					item.checkbox = oldCheckbox;
					fi.push(item);
					this.weekData.set(fromKey, fi);
					await this.guardedSave(fromDate, fi);
				}
			},
		};
		this.undoManager.pushExecuted(action);

		await this.refresh();
	}

	// ── Block Complete/Uncomplete ──

	private async onBlockComplete(dayIndex: number, item: TimelineItem) {
		const date = this.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const items = this.weekData.get(dateKey) || [];
		const idx = items.findIndex(i => i.id === item.id);
		if (idx === -1) return;

		const oldCheckbox = items[idx].checkbox;
		items[idx].checkbox = "actual";

		await this.guardedSave(date, items);

		const action: UndoableAction = {
			description: "Complete block",
			execute: async () => { /* already executed */ },
			undo: async () => {
				const items = this.weekData.get(dateKey) || [];
				const idx = items.findIndex(i => i.id === item.id);
				if (idx !== -1) {
					items[idx].checkbox = oldCheckbox;
					await this.guardedSave(date, items);
				}
			},
		};
		this.undoManager.pushExecuted(action);

		// Check for project task link: [[...#^...]]
		const linkMatch = item.content.match(/\[\[([^#\]]+)#\^([a-zA-Z0-9-]+)\]\]/);
		if (linkMatch) {
			const projectNoteName = linkMatch[1];
			const blockId = linkMatch[2];
			// Find the project file path
			const projectFile = this.app.vault.getMarkdownFiles().find(
				(f) => f.basename === projectNoteName
			);
			if (projectFile) {
				new ConfirmModal(
					this.app,
					"Mark the original project task as complete too?",
					async () => {
						this.isSelfWriting = true;
						try {
							await completeProjectTask(
								this.app.vault,
								projectFile.path,
								blockId
							);
						} finally {
							this.isSelfWriting = false;
						}
					}
				).open();
			}
		}

		await this.refresh();
	}

	private async onBlockUncomplete(dayIndex: number, item: TimelineItem) {
		const date = this.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const items = this.weekData.get(dateKey) || [];
		const idx = items.findIndex(i => i.id === item.id);
		if (idx === -1) return;

		const oldCheckbox = items[idx].checkbox;
		const oldActualTime = items[idx].actualTime ? { ...items[idx].actualTime! } : undefined;
		items[idx].checkbox = "plan";
		items[idx].actualTime = undefined;

		await this.guardedSave(date, items);

		const action: UndoableAction = {
			description: "Uncomplete block",
			execute: async () => { /* already executed */ },
			undo: async () => {
				const items = this.weekData.get(dateKey) || [];
				const idx = items.findIndex(i => i.id === item.id);
				if (idx !== -1) {
					items[idx].checkbox = oldCheckbox;
					items[idx].actualTime = oldActualTime;
					await this.guardedSave(date, items);
				}
			},
		};
		this.undoManager.pushExecuted(action);
		await this.refresh();
	}

	// ── Block Sorting (Compact) ──

	private async sortBlocksCompact() {
		const settings = this.plugin.settings;
		const dayStartMinutes = settings.dayStartHour * 60;

		// Save old state for undo
		const oldWeekData = new Map<string, TimelineItem[]>();
		for (const [key, items] of this.weekData) {
			oldWeekData.set(
				key,
				items.map((i) => ({
					...i,
					planTime: { ...i.planTime },
					actualTime: i.actualTime ? { ...i.actualTime } : undefined,
					tags: [...i.tags],
				}))
			);
		}

		// Compact each day
		for (let d = 0; d < 7; d++) {
			const dateKey = this.dates[d].format("YYYY-MM-DD");
			const items = this.weekData.get(dateKey) || [];

			const plans = items
				.filter((i) => i.checkbox === "plan")
				.sort((a, b) => a.planTime.start - b.planTime.start);
			const others = items.filter((i) => i.checkbox !== "plan");

			let cursor = dayStartMinutes;
			for (const item of plans) {
				const duration = item.planTime.end - item.planTime.start;
				item.planTime = { start: cursor, end: cursor + duration };
				cursor += duration;
			}

			this.weekData.set(dateKey, [...plans, ...others]);
			await this.guardedSave(this.dates[d], this.weekData.get(dateKey)!);
		}

		const action: UndoableAction = {
			description: "Compact plan blocks",
			execute: async () => {
				/* already executed */
			},
			undo: async () => {
				for (let d = 0; d < 7; d++) {
					const dateKey = this.dates[d].format("YYYY-MM-DD");
					const oldItems = oldWeekData.get(dateKey) || [];
					this.weekData.set(dateKey, oldItems);
					await this.guardedSave(this.dates[d], oldItems);
				}
			},
		};
		this.undoManager.pushExecuted(action);
		await this.refresh();
	}

	// ── Preset Menu ──

	private showPresetMenu(e: MouseEvent) {
		const menu = document.createElement("div");
		menu.className = "weekflow-preset-menu";
		menu.style.position = "fixed";
		menu.style.left = `${e.clientX}px`;
		menu.style.top = `${e.clientY}px`;
		menu.style.zIndex = "1000";
		menu.style.background = "var(--background-primary)";
		menu.style.border = "1px solid var(--background-modifier-border)";
		menu.style.borderRadius = "6px";
		menu.style.padding = "4px";
		menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
		menu.style.minWidth = "180px";

		// "Create preset from today" option
		const createItem = document.createElement("div");
		createItem.className = "weekflow-preset-menu-item";
		createItem.textContent = "Save current day as preset...";
		createItem.addEventListener("click", () => {
			menu.remove();
			this.createPresetFromToday();
		});
		menu.appendChild(createItem);

		// Saved presets
		for (const preset of this.plugin.settings.presets) {
			const item = document.createElement("div");
			item.className = "weekflow-preset-menu-item";
			item.textContent = `${preset.name} (${preset.slots.length})`;
			item.addEventListener("click", () => {
				menu.remove();
				this.applyPreset(preset);
			});
			menu.appendChild(item);
		}

		if (this.plugin.settings.presets.length === 0) {
			const empty = document.createElement("div");
			empty.className = "weekflow-preset-menu-item";
			empty.style.color = "var(--text-muted)";
			empty.textContent = "No presets saved";
			menu.appendChild(empty);
		}

		document.body.appendChild(menu);
		const closeMenu = (ev: MouseEvent) => {
			if (!menu.contains(ev.target as Node)) {
				menu.remove();
				document.removeEventListener("mousedown", closeMenu);
			}
		};
		setTimeout(() => document.addEventListener("mousedown", closeMenu), 0);
	}

	private createPresetFromToday() {
		const todayKey = window.moment().format("YYYY-MM-DD");
		const items = this.weekData.get(todayKey) || [];
		const planItems = items.filter((i) => i.checkbox === "plan");
		const slots = planItems.map((i) => ({
			start: i.planTime.start,
			end: i.planTime.end,
			content: i.content,
			tag: i.tags[0] || "",
		}));
		new CreatePresetModal(this.app, slots, async (preset) => {
			this.plugin.settings.presets.push(preset);
			await this.plugin.saveSettings();
		}).open();
	}

	private applyPreset(preset: import("./types").TimeSlotPreset) {
		new ApplyPresetModal(
			this.app,
			preset,
			this.dates,
			async (selectedDays, overwrite) => {
				// Save old state for undo
				const oldData = new Map<string, TimelineItem[]>();
				for (const d of selectedDays) {
					const dateKey = this.dates[d].format("YYYY-MM-DD");
					const items = this.weekData.get(dateKey) || [];
					oldData.set(
						dateKey,
						items.map((i) => ({
							...i,
							planTime: { ...i.planTime },
							actualTime: i.actualTime
								? { ...i.actualTime }
								: undefined,
							tags: [...i.tags],
						}))
					);
				}

				for (const d of selectedDays) {
					const date = this.dates[d];
					const dateKey = date.format("YYYY-MM-DD");
					let existing = this.weekData.get(dateKey) || [];

					if (overwrite) {
						existing = existing.filter(
							(i) => i.checkbox !== "plan"
						);
					}

					for (const slot of preset.slots) {
						existing.push({
							id: generateItemId(),
							checkbox: "plan",
							planTime: { start: slot.start, end: slot.end },
							content: slot.content,
							tags: slot.tag ? [slot.tag] : [],
							rawSuffix: "",
						});
					}

					this.weekData.set(dateKey, existing);
					await this.guardedSave(date, existing);
				}

				const action: UndoableAction = {
					description: "Apply preset",
					execute: async () => {
						/* already executed */
					},
					undo: async () => {
						for (const [dateKey, items] of oldData) {
							this.weekData.set(dateKey, items);
							const d = selectedDays.find(
								(i) =>
									this.dates[i].format("YYYY-MM-DD") ===
									dateKey
							);
							if (d !== undefined) {
								await this.guardedSave(this.dates[d], items);
							}
						}
					},
				};
				this.undoManager.pushExecuted(action);
				await this.refresh();
			}
		).open();
	}

	private getCategoryColorForTags(tags: string[]): string {
		for (const tag of tags) {
			const cat = this.plugin.settings.categories.find(c => c.tag === tag);
			if (cat) return cat.color;
		}
		return "#888888";
	}

	// Persist/restore view state
	getState(): Record<string, unknown> {
		return {
			currentDate: this.currentDate.format("YYYY-MM-DD"),
		};
	}

	async setState(state: any, result: { history: boolean }): Promise<void> {
		if (typeof state.currentDate === "string") {
			this.currentDate = window.moment(state.currentDate, "YYYY-MM-DD");
		}
		await this.refresh();
	}
}
