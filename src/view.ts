import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf, type TAbstractFile, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type WeekFlowPlugin from "./main";
import { VIEW_TYPE_WEEKFLOW } from "./types";
import type { CalendarEvent, PanelItem, ParseWarning, TimelineItem, WeekFlowSettings } from "./types";
import { getCalendarEventsForWeek, clearCalendarCache } from "./calendar";
import { getWeekDates, getWeekNotePaths, loadWeekData, saveDailyNoteItems, resolveDailyNotePath, getInboxItems, getInboxWatchPaths, addToInbox, getPrimaryInboxNoteSource, getActiveProjects, getProjectTasks, loadWeekReviewData } from "./daily-note";
import type { ProjectInfo, InboxCheckboxItem } from "./daily-note";
import { GridRenderer } from "./grid-renderer";
import { BlockModal } from "./block-modal";
import { EditBlockModal } from "./edit-block-modal";
import { generateItemId } from "./parser";
import { UndoManager, type UndoableAction } from "./undo-manager";
import { PlanningPanel, type PanelSection } from "./planning-panel";
import type { CheckboxItem } from "./parser";
import { getLayoutTier, getVisibleDays, isTouchDevice, type LayoutTier } from "./device";
import { ReviewPanelController } from "./review-panel";
import { showPresetMenu } from "./preset-manager";
import { BlockActions } from "./block-actions";
import { collectOverdueItems, collectInboxPanelItems } from "./panel-data";

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
	private inboxItems: InboxCheckboxItem[] = [];
	private projectData: { project: ProjectInfo; tasks: CheckboxItem[] }[] = [];

	// Calendar events
	private calendarEvents: CalendarEvent[] = [];

	// Review panel
	private reviewController: ReviewPanelController | null = null;

	// Block actions
	private blockActions: BlockActions | null = null;

	// Responsive layout
	private resizeObserver: ResizeObserver | null = null;
	private currentLayoutTier: LayoutTier = "wide";
	private currentVisibleDays = 7;
	private currentDayOffset = 0;
	private pendingDayOffset: number | null = null;
	private viewModeOverride: "auto" | 7 | 3 | 1 = "auto";

	// Bottom sheet (narrow mode)
	private bottomSheetEl: HTMLElement | null = null;

	// Panel drag state
	private panelDragItem: PanelItem | null = null;
	private boundPanelDragMove: ((e: PointerEvent) => void) | null = null;
	private boundPanelDragUp: ((e: PointerEvent) => void) | null = null;

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

		// Set initial layout tier from container width
		const initialWidth = this.contentEl.clientWidth;
		if (initialWidth > 0) {
			this.currentLayoutTier = getLayoutTier(initialWidth);
			this.currentVisibleDays = getVisibleDays(this.currentLayoutTier);
		}

		await this.refresh();

		// Block Obsidian sidebar swipe: unconditionally stop touch event
		// propagation on the entire view container. Native vertical scrolling
		// still works because touch-action: pan-y is handled by the browser
		// before JS listeners; stopPropagation only prevents Obsidian's
		// sidebar gesture JS handler from seeing these events.
		this.contentEl.addEventListener("touchmove", (e) => {
			e.stopPropagation();
		}, { passive: true });

		// ResizeObserver for responsive layout changes
		this.resizeObserver = new ResizeObserver((entries) => {
			const width = entries[0].contentRect.width;
			const newTier = getLayoutTier(width);
			if (newTier !== this.currentLayoutTier) {
				this.onLayoutTierChanged(newTier);
			}
		});
		this.resizeObserver.observe(this.contentEl);
	}

	async onClose() {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.syncDebounceTimer) {
			clearTimeout(this.syncDebounceTimer);
		}
		if (this.reviewController) {
			this.reviewController.destroy();
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

	private onLayoutTierChanged(tier: LayoutTier): void {
		this.currentLayoutTier = tier;

		// Toggle layout CSS classes (always based on real width — affects panel/bottom-sheet)
		this.contentEl.removeClass("weekflow-layout-wide", "weekflow-layout-medium", "weekflow-layout-narrow");
		this.contentEl.addClass(`weekflow-layout-${tier}`);

		// Only update visibleDays/dayOffset in auto mode
		if (this.viewModeOverride === "auto") {
			const newDays = getVisibleDays(tier);
			this.currentVisibleDays = newDays;
			this.currentDayOffset = this.calculateDayOffset(newDays);
		}

		this.renderView();
	}

	private setViewModeOverride(mode: "auto" | 7 | 3 | 1): void {
		this.viewModeOverride = mode;
		if (mode === "auto") {
			this.currentVisibleDays = getVisibleDays(this.currentLayoutTier);
		} else {
			this.currentVisibleDays = mode;
		}
		this.currentDayOffset = this.calculateDayOffset(this.currentVisibleDays);
		this.renderView();
	}

	private showViewModeMenu(e: MouseEvent | PointerEvent): void {
		const menu = new Menu();
		const options: { label: string; value: "auto" | 7 | 3 | 1 }[] = [
			{ label: "7 days", value: 7 },
			{ label: "3 days", value: 3 },
			{ label: "1 day", value: 1 },
		];
		for (const opt of options) {
			menu.addItem((mi) => {
				mi.setTitle(opt.label);
				mi.setChecked(this.viewModeOverride === opt.value);
				mi.onClick(() => this.setViewModeOverride(opt.value));
			});
		}
		menu.addSeparator();
		menu.addItem((mi) => {
			mi.setTitle("Auto");
			mi.setChecked(this.viewModeOverride === "auto");
			mi.onClick(() => this.setViewModeOverride("auto"));
		});
		menu.showAtMouseEvent(e);
	}

	private calculateDayOffset(visibleDays: number): number {
		if (visibleDays >= 7) return 0;

		// Find today's index within the week
		const today = window.moment().startOf("day");
		let todayIndex = this.dates.findIndex((d) => d.isSame(today, "day"));
		if (todayIndex === -1) todayIndex = 0;

		if (visibleDays === 1) {
			return todayIndex;
		}

		// 3-day view: fixed pages [0, 2, 4] with 1-day overlap
		// Pick the earliest page that contains today (shows more past context)
		const pages = [0, 2, 4];
		for (const offset of pages) {
			if (todayIndex >= offset && todayIndex < offset + visibleDays) {
				return offset;
			}
		}
		return 0;
	}

	async refresh() {
		const settings = this.plugin.settings;
		const newDates = getWeekDates(this.currentDate, settings.weekStartDay);
		const weekChanged = this.dates.length === 0 || !this.dates[0].isSame(newDates[0], "day");
		this.dates = newDates;
		this.weekNotePaths = getWeekNotePaths(this.dates, settings);

		// Recalculate dayOffset only when week actually changed or pending offset exists
		if (this.pendingDayOffset !== null) {
			this.currentDayOffset = this.pendingDayOffset;
			this.pendingDayOffset = null;
		} else if (weekChanged) {
			this.currentDayOffset = this.calculateDayOffset(this.currentVisibleDays);
		}

		// Add inbox source paths to watched files
		const inboxPaths = getInboxWatchPaths(this.app.vault, settings.inboxSources, settings.dailyNotePath);
		for (const ip of inboxPaths) {
			if (!this.weekNotePaths.includes(ip)) {
				this.weekNotePaths.push(ip);
			}
		}

		// Load week data, inbox, and review data (local — fast)
		const [result, inbox, reviewData] = await Promise.all([
			loadWeekData(this.app.vault, this.dates, settings),
			getInboxItems(this.app.vault, settings),
			loadWeekReviewData(this.app.vault, this.dates, settings),
		]);
		this.weekData = result.weekData;
		this.weekWarnings = result.warnings;
		this.inboxItems = inbox;

		// Initialize or update review controller
		const reviewDeps = {
			app: this.app,
			settings: this.plugin.settings,
			dates: this.dates,
			contentEl: this.contentEl,
			withSelfWriteGuard: <T>(fn: () => Promise<T>) => this.withSelfWriteGuard(fn),
			saveSettings: () => this.plugin.saveSettings(),
		};
		if (!this.reviewController) {
			this.reviewController = new ReviewPanelController(reviewDeps);
		} else {
			this.reviewController.updateDeps(reviewDeps);
		}
		this.reviewController.loadData(reviewData);

		// Initialize or update block actions
		const blockActionsCtx = {
			app: this.app,
			settings: this.plugin.settings,
			dates: this.dates,
			weekData: this.weekData,
			undoManager: this.undoManager,
			guardedSave: (date: ReturnType<typeof moment>, items: TimelineItem[]) => this.guardedSave(date, items),
			withSelfWriteGuard: <T>(fn: () => Promise<T>) => this.withSelfWriteGuard(fn),
			refresh: () => this.refresh(),
			projectData: this.projectData,
		};
		if (!this.blockActions) {
			this.blockActions = new BlockActions(blockActionsCtx);
		} else {
			this.blockActions.updateCtx(blockActionsCtx);
		}

		this.renderView();

		// Load calendar events async — don't block view rendering on network I/O
		this.loadCalendarEventsAsync(settings);
	}

	private async loadProjectDataAsync(settings: WeekFlowSettings) {
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

		// Patch planning panel with project sections
		if (this.planningPanel) {
			this.buildPanelSections();
			this.planningPanel.render(this.panelSections);
		}
	}

	private async loadCalendarEventsAsync(settings: WeekFlowSettings) {
		if (settings.calendarSources.length === 0) {
			this.calendarEvents = [];
			return;
		}

		const weekStart = this.dates[0].toDate();
		const weekEnd = new Date(this.dates[6].toDate());
		weekEnd.setDate(weekEnd.getDate() + 1);

		try {
			const calendarResult = await getCalendarEventsForWeek(
				settings.calendarSources, weekStart, weekEnd, settings.calendarCacheDuration
			);
			this.calendarEvents = calendarResult.events;

			if (calendarResult.errors.length > 0) {
				for (const err of calendarResult.errors) {
					new Notice(`WeekFlow Calendar: ${err}`);
				}
			}
		} catch {
			this.calendarEvents = [];
		}

		// Update the grid overlay without full re-render
		if (this.gridRenderer) {
			this.gridRenderer.setCalendarEvents(this.calendarEvents);
			this.gridRenderer.renderCalendarOverlayOnly();
		}
	}

	private renderView() {
		// Save scroll position before destroying the DOM
		const prevGridWrapper = this.contentEl.querySelector(".weekflow-grid-wrapper") as HTMLElement | null;
		const savedScrollTop = prevGridWrapper?.scrollTop ?? 0;
		const savedScrollLeft = prevGridWrapper?.scrollLeft ?? 0;

		// Clean up old grid renderer listeners before rebuilding
		if (this.gridRenderer) {
			this.gridRenderer.destroy();
		}

		const container = this.contentEl;
		container.empty();
		container.addClass("weekflow-container");

		// Apply layout tier class
		container.removeClass("weekflow-layout-wide", "weekflow-layout-medium", "weekflow-layout-narrow");
		container.addClass(`weekflow-layout-${this.currentLayoutTier}`);

		// Toolbar
		this.renderToolbar(container);

		// Warning banner
		this.renderWarnings(container);

		// Body: main (panel + content area)
		const body = container.createDiv({ cls: "weekflow-body" });

		// Main area (panel + content area)
		const main = body.createDiv({ cls: "weekflow-main" });

		// Planning panel — side panel for wide/medium, bottom sheet for narrow
		this.buildPanelSections();
		if (this.currentLayoutTier !== "narrow") {
			const panelEl = main.createDiv({ cls: "weekflow-panel" });
			if (!this.plugin.settings.planningPanelOpen) {
				panelEl.addClass("collapsed");
			}
			if (this.currentLayoutTier === "medium") {
				// Default collapsed in medium mode
				if (!this.plugin.settings.planningPanelOpen) {
					panelEl.addClass("collapsed");
				}
			}
			this.planningPanel = new PlanningPanel(panelEl, {
				onItemDragStart: (item, e) => this.onPanelDragStart(item, e),
				onItemNavigate: (item) => this.navigateToPanelItemSource(item),
			});
			this.planningPanel.render(this.panelSections);
		}

		// Content area (grid + review, shares same width)
		const contentArea = main.createDiv({ cls: "weekflow-content-area" });

		// Grid wrapper
		const gridWrapper = contentArea.createDiv({ cls: "weekflow-grid-wrapper" });

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
				onBlockDragEnd: (item, fromDay, toDay, newStart, newDuration?) =>
					this.onBlockDragEnd(item, fromDay, toDay, newStart, newDuration),
				onBlockResize: (item, dayIndex, newStart, newEnd) =>
					this.onBlockResize(item, dayIndex, newStart, newEnd),
				onBlockDropOutside: (item, fromDay) =>
					this.onBlockReturnToInbox(item, fromDay),
				onBlockComplete: (dayIndex, item) =>
					this.onBlockComplete(dayIndex, item),
				onBlockUncomplete: (dayIndex, item) =>
					this.onBlockUncomplete(dayIndex, item),
				onBlockRightClick: (dayIndex, item, event) =>
					this.onBlockRightClick(dayIndex, item, event),
				onBlockNavigate: (dayIndex, item) =>
					this.openDailyNoteAtLine(dayIndex, item.lineNumber),
				onBlockDelete: (dayIndex, item) =>
					this.deleteBlock(dayIndex, item),
				onSwipeLeft: () => this.onSwipeGesture("left"),
				onSwipeRight: () => this.onSwipeGesture("right"),
			}
		);
		this.gridRenderer.setVisibleRange(this.currentVisibleDays, this.currentDayOffset);
		this.gridRenderer.setCalendarEvents(this.calendarEvents);
		this.gridRenderer.render();

		// Scroll → deselect touch block selection
		gridWrapper.addEventListener("scroll", () => {
			this.gridRenderer?.clearTouchSelection();
		}, { passive: true });

		// Tap on grid → deselect panel item selection
		gridWrapper.addEventListener("pointerdown", () => {
			this.planningPanel?.deselectAll();
		});

		// Restore scroll position after grid rebuild
		gridWrapper.scrollTop = savedScrollTop;
		gridWrapper.scrollLeft = savedScrollLeft;

		// Review panel (inside content area — aligns with grid columns)
		if (this.reviewController) {
			this.reviewController.render(contentArea, this.currentVisibleDays, this.currentDayOffset);
		}

		// Bottom sheet (narrow mode only)
		if (this.currentLayoutTier === "narrow") {
			this.renderBottomSheet(body);
		}
	}

	private toggleReviewPanel() {
		if (this.reviewController) {
			this.reviewController.toggle();
		}
	}

	// ── Bottom Sheet (Narrow mode Planning Panel) ──

	private renderBottomSheet(container: HTMLElement): void {
		const sheet = container.createDiv({ cls: "weekflow-bottom-sheet collapsed" });
		this.bottomSheetEl = sheet;

		// Handle bar (swipe up/down to expand/collapse)
		const handleBar = sheet.createDiv({ cls: "weekflow-bottom-sheet-handle" });
		handleBar.createDiv({ cls: "weekflow-bottom-sheet-bar" });

		let sheetStartY = 0;
		let isExpanded = false;

		handleBar.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			handleBar.setPointerCapture(e.pointerId);
			sheetStartY = e.clientY;
		});

		handleBar.addEventListener("pointerup", (e) => {
			const dy = sheetStartY - e.clientY;
			if (Math.abs(dy) > 40) {
				isExpanded = dy > 0;
				sheet.toggleClass("collapsed", !isExpanded);
				sheet.toggleClass("expanded", isExpanded);
			} else {
				// Tap: toggle
				isExpanded = !isExpanded;
				sheet.toggleClass("collapsed", !isExpanded);
				sheet.toggleClass("expanded", isExpanded);
			}
		});

		// Content (reuses PlanningPanel)
		const contentEl = sheet.createDiv({ cls: "weekflow-bottom-sheet-content" });
		this.planningPanel = new PlanningPanel(contentEl, {
			onItemDragStart: (item, e) => this.onPanelDragStart(item, e),
			onItemNavigate: (item) => this.navigateToPanelItemSource(item),
		});
		this.planningPanel.render(this.panelSections);
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

	private renderToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "weekflow-toolbar" });

		// ── Row 1: Navigation + Tools ──
		const row1 = toolbar.createDiv({ cls: "weekflow-toolbar-row" });

		// Left: Navigation
		const nav = row1.createDiv({ cls: "weekflow-toolbar-nav" });

		const panelToggleBtn = nav.createEl("button");
		setIcon(panelToggleBtn, "panel-left");
		panelToggleBtn.ariaLabel = "Toggle planning panel";
		if (this.plugin.settings.planningPanelOpen) panelToggleBtn.addClass("active");
		panelToggleBtn.addEventListener("click", () => this.togglePanel());

		// Determine if today is visible and which direction it is
		const today = window.moment().startOf("day");
		const visStart = this.dates[this.currentDayOffset];
		const visEnd = this.dates[this.currentDayOffset + this.currentVisibleDays - 1];
		const todayVisible = today.isBetween(visStart, visEnd, "day", "[]");
		const todayBefore = today.isBefore(visStart, "day"); // today is to the left (prev)
		const todayAfter = today.isAfter(visEnd, "day"); // today is to the right (next)

		const prevBtn = nav.createEl("button", { text: "\u25C0" });
		if (todayBefore) prevBtn.addClass("weekflow-nav-today-hint");
		if (this.currentVisibleDays < 7) {
			prevBtn.addEventListener("click", () => this.onSwipe("right"));
		} else {
			prevBtn.addEventListener("click", () => this.navigateWeek(-1));
		}

		const weekLabel = nav.createSpan({ cls: "weekflow-week-label" });
		weekLabel.addEventListener("click", (e) => this.showViewModeMenu(e));
		if (this.currentVisibleDays < 7) {
			const weekNum = this.dates[0].format("[W]ww");
			const startDate = this.dates[this.currentDayOffset];
			const endDate = this.dates[this.currentDayOffset + this.currentVisibleDays - 1];
			weekLabel.setText(`${weekNum} \u00B7 ${startDate.format("MM/DD")}\u2013${endDate.format("MM/DD")}`);
		} else {
			weekLabel.setText(this.dates[0].format("[W]ww, YYYY"));
		}
		if (this.viewModeOverride !== "auto") {
			weekLabel.createSpan({ text: `(${this.viewModeOverride}d)`, cls: "weekflow-viewmode-indicator" });
		}

		const nextBtn = nav.createEl("button", { text: "\u25B6" });
		if (todayAfter) nextBtn.addClass("weekflow-nav-today-hint");
		if (this.currentVisibleDays < 7) {
			nextBtn.addEventListener("click", () => this.onSwipe("left"));
		} else {
			nextBtn.addEventListener("click", () => this.navigateWeek(1));
		}

		const todayBtn = nav.createEl("button", { text: "Today" });
		if (!todayVisible) todayBtn.addClass("weekflow-nav-today-hint");
		todayBtn.addEventListener("click", () => {
			this.currentDate = window.moment();
			this.pendingDayOffset = this.calculateDayOffset(this.currentVisibleDays);
			this.refresh();
		});

		// Right: Tools (visible buttons + overflow menu)
		const tools = row1.createDiv({ cls: "weekflow-toolbar-tools" });

		// Define tool items for both inline buttons and overflow menu
		const toolItems: { icon: string; label: string; action: (e?: MouseEvent | PointerEvent) => void; active?: boolean; disabled?: boolean }[] = [
			{ icon: "rotate-ccw", label: "Refresh", action: () => { clearCalendarCache(); this.refresh(); } },
			{ icon: "undo-2", label: "Undo", action: () => this.undo(), disabled: !this.undoManager.canUndo() },
			{ icon: "redo-2", label: "Redo", action: () => this.redo(), disabled: !this.undoManager.canRedo() },
			{ icon: "clock", label: "Presets", action: (e) => { if (e) this.showPresetMenu(e); } },
			{ icon: "chart-bar", label: "Statistics", action: () => this.plugin.activateStatsView() },
			{ icon: "file-text", label: "Review panel", action: () => this.toggleReviewPanel(), active: this.plugin.settings.reviewPanelOpen },
		];

		const toolBtns: HTMLElement[] = [];
		for (const item of toolItems) {
			const btn = tools.createEl("button");
			btn.addClass("weekflow-tool-btn");
			setIcon(btn, item.icon);
			btn.ariaLabel = item.label;
			if (item.active) btn.addClass("active");
			if (item.disabled) btn.addClass("weekflow-btn-disabled");
			btn.addEventListener("click", (e) => item.action(e));
			toolBtns.push(btn);
		}

		// Overflow "..." button — sibling of tools (outside overflow container)
		const overflowBtn = row1.createEl("button", { cls: "weekflow-overflow-btn" });
		setIcon(overflowBtn, "more-horizontal");
		overflowBtn.ariaLabel = "More tools";
		overflowBtn.style.display = "none";
		overflowBtn.addEventListener("click", (e) => {
			const menu = new Menu();
			for (let i = 0; i < toolBtns.length; i++) {
				if (this.isElementOverflowing(toolBtns[i], tools)) {
					const item = toolItems[i];
					menu.addItem((mi) => {
						mi.setTitle(item.label);
						mi.setIcon(item.icon);
						if (item.disabled) mi.setDisabled(true);
						mi.onClick(() => item.action(e));
					});
				}
			}
			menu.showAtMouseEvent(e);
		});

		// Observe tool overflow
		const toolsObserver = new ResizeObserver(() => {
			let anyHidden = false;
			for (const btn of toolBtns) {
				if (this.isElementOverflowing(btn, tools)) {
					anyHidden = true;
					break;
				}
			}
			overflowBtn.style.display = anyHidden ? "" : "none";
		});
		toolsObserver.observe(tools);

		// ── Row 2: Category palette (horizontally scrollable) ──
		const palette = toolbar.createDiv({ cls: "weekflow-palette" });
		if (!this.selectedCategory && this.plugin.settings.categories.length > 0) {
			this.selectedCategory = this.plugin.settings.categories[0].tag;
		}
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

	/** Update toolbar navigation labels and today hints without full rebuild */
	private updateToolbarNav(): void {
		const nav = this.contentEl.querySelector(".weekflow-toolbar-nav");
		if (!nav) return;

		// Update week label
		const weekLabel = nav.querySelector(".weekflow-week-label") as HTMLElement | null;
		if (weekLabel) {
			if (this.currentVisibleDays < 7) {
				const weekNum = this.dates[0].format("[W]ww");
				const startDate = this.dates[this.currentDayOffset];
				const endDate = this.dates[this.currentDayOffset + this.currentVisibleDays - 1];
				weekLabel.setText(`${weekNum} \u00B7 ${startDate.format("MM/DD")}\u2013${endDate.format("MM/DD")}`);
			} else {
				weekLabel.setText(this.dates[0].format("[W]ww, YYYY"));
			}
			// Re-add override indicator (setText clears children)
			if (this.viewModeOverride !== "auto") {
				weekLabel.createSpan({ text: `(${this.viewModeOverride}d)`, cls: "weekflow-viewmode-indicator" });
			}
		}

		// Update today hints on ◀/▶ and Today buttons
		const today = window.moment().startOf("day");
		const visStart = this.dates[this.currentDayOffset];
		const visEnd = this.dates[this.currentDayOffset + this.currentVisibleDays - 1];
		const todayVisible = today.isBetween(visStart, visEnd, "day", "[]");
		const todayBefore = today.isBefore(visStart, "day");
		const todayAfter = today.isAfter(visEnd, "day");

		const buttons = nav.querySelectorAll("button");
		// buttons order: panelToggle, prev(◀), next(▶), Today
		if (buttons.length >= 4) {
			buttons[1].removeClass("weekflow-nav-today-hint");
			buttons[2].removeClass("weekflow-nav-today-hint");
			buttons[3].removeClass("weekflow-nav-today-hint");
			if (todayBefore) buttons[1].addClass("weekflow-nav-today-hint");
			if (todayAfter) buttons[2].addClass("weekflow-nav-today-hint");
			if (!todayVisible) buttons[3].addClass("weekflow-nav-today-hint");
		}
	}

	/** Update review panel columns for new dayOffset without full rebuild */
	private updateReviewPanel(): void {
		if (this.reviewController) {
			this.reviewController.update(this.currentVisibleDays, this.currentDayOffset);
		}
	}

	goToThisWeek(): void {
		this.currentDate = window.moment();
		this.refresh();
	}

	private async navigateWeek(delta: number) {
		this.currentDate = this.currentDate
			.clone()
			.add(delta * 7, "days");
		await this.refresh();
	}

	private onSwipeGesture(direction: "left" | "right"): void {
		// On 7-day+desktop, gesture swipe is disabled (would conflict with mouse drag)
		if (this.currentVisibleDays >= 7 && !isTouchDevice()) return;
		this.onSwipe(direction);
	}

	private onSwipe(direction: "left" | "right"): void {
		const delta = direction === "left" ? 1 : -1;

		if (this.currentVisibleDays >= 7) {
			// Wide: swipe changes week
			this.navigateWeek(delta);
		} else {
			// Medium (3-day): step by 2 for fixed pages [0,2,4]
			// Narrow (1-day): step by 1
			const step = this.currentVisibleDays >= 3 ? 2 : 1;
			const maxOffset = 7 - this.currentVisibleDays;
			const newOffset = this.currentDayOffset + delta * step;
			const clamped = Math.max(0, Math.min(newOffset, maxOffset));
			if (clamped !== this.currentDayOffset) {
				this.currentDayOffset = clamped;
				this.updatePage();
			} else {
				// Already at edge → cross week boundary
				// Going backward: land on last page; forward: land on first page
				this.pendingDayOffset = delta < 0 ? maxOffset : 0;
				this.navigateWeek(delta);
			}
		}
	}

	/** Lightweight page update — re-renders grid + toolbar + review without reloading data */
	private updatePage(): void {
		if (this.gridRenderer) {
			this.gridRenderer.destroy();
			this.gridRenderer.setVisibleRange(this.currentVisibleDays, this.currentDayOffset);
			this.gridRenderer.render();
		}
		// Update toolbar (week label, today hints)
		this.updateToolbarNav();
		// Update review panel columns
		this.updateReviewPanel();
	}

	// ── Save helper with self-writing guard ──

	private async withSelfWriteGuard<T>(fn: () => Promise<T>): Promise<T> {
		this.isSelfWriting = true;
		try {
			return await fn();
		} finally {
			this.isSelfWriting = false;
		}
	}

	private async guardedSave(date: Moment, items: TimelineItem[]) {
		await this.withSelfWriteGuard(() =>
			saveDailyNoteItems(this.app.vault, date, this.plugin.settings, items)
		);
	}

	// ── Undo/Redo ──

	async undo() {
		if (!this.undoManager.canUndo()) return;
		await this.withSelfWriteGuard(() => this.undoManager.undo());
		await this.refresh();
	}

	async redo() {
		if (!this.undoManager.canRedo()) return;
		await this.withSelfWriteGuard(() => this.undoManager.redo());
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

		// Clear selection immediately so tap-tap state resets
		// (otherwise dismissed modal leaves stale anchor)
		this.gridRenderer.clearSelection();

		new BlockModal(
			this.app,
			planTime,
			effectiveMode,
			this.plugin.settings.categories,
			async (result) => {
				const checkbox = effectiveMode === "actual" ? "actual" : "plan";
				const finalPlanTime = {
					start: result.startMinutes,
					end: result.endMinutes,
				};
				const newItem: TimelineItem = {
					id: generateItemId(),
					checkbox: checkbox,
					planTime: finalPlanTime,
					content: result.content,
					tags: result.tag ? [result.tag] : [],
					rawSuffix: "",
				};

				const dayIndex = selection.dayIndex;
				const date = this.dates[dayIndex];
				const dateKey = date.format("YYYY-MM-DD");

				// Check for overnight split
				const splitResult = this.blockActions!.splitOvernightItem(newItem, dayIndex);
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

				await this.refresh();
			},
			this.selectedCategory
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
					await this.deleteBlock(dayIndex, item);
					return;
				}

				if (result.action === "complete") {
					await this.onBlockComplete(dayIndex, item);
					return;
				}

				if (result.action === "uncomplete") {
					await this.onBlockUncomplete(dayIndex, item);
					return;
				}

				// Save (edit)
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
				await this.refresh();
			}
		).open();
	}

	// ── Block Drag/Resize/Split (delegated to BlockActions) ──

	private async onBlockDragEnd(
		item: TimelineItem,
		fromDay: number,
		toDay: number,
		newStart: number,
		newDuration?: number
	) {
		await this.blockActions!.onBlockDragEnd(item, fromDay, toDay, newStart, newDuration);
	}

	private async onBlockResize(
		item: TimelineItem,
		dayIndex: number,
		newStart: number,
		newEnd: number
	) {
		await this.blockActions!.onBlockResize(item, dayIndex, newStart, newEnd);
	}

	// ── Planning Panel ──

	togglePlanningPanel() {
		this.togglePanel();
	}

	private isElementOverflowing(el: HTMLElement, container: HTMLElement): boolean {
		return el.offsetLeft + el.offsetWidth > container.clientWidth;
	}

	private togglePanel() {
		this.plugin.settings.planningPanelOpen = !this.plugin.settings.planningPanelOpen;
		this.plugin.saveSettings();

		// Side panel (wide/medium mode)
		const panelEl = this.contentEl.querySelector(".weekflow-panel") as HTMLElement | null;
		if (panelEl) {
			panelEl.toggleClass("collapsed", !this.plugin.settings.planningPanelOpen);
		}

		// Bottom sheet (narrow mode)
		if (this.bottomSheetEl) {
			const isExpanded = this.plugin.settings.planningPanelOpen;
			this.bottomSheetEl.toggleClass("collapsed", !isExpanded);
			this.bottomSheetEl.toggleClass("expanded", isExpanded);
		}
	}

	private buildPanelSections(): void {
		const hasPrimaryNoteSource = getPrimaryInboxNoteSource(this.app.vault, this.plugin.settings.inboxSources) !== null;
		const hasMultipleSources = this.plugin.settings.inboxSources.length > 1;
		this.panelSections = [
			{
				type: "overdue",
				title: "Overdue",
				icon: "alert-triangle",
				items: collectOverdueItems(this.dates, this.weekData),
				collapsed: false,
			},
			{
				type: "inbox",
				title: "Inbox",
				icon: "inbox",
				items: collectInboxPanelItems(this.inboxItems),
				collapsed: false,
				canAddItem: hasPrimaryNoteSource,
				showSourcePath: hasMultipleSources,
				onAddItem: hasPrimaryNoteSource
					? (text: string) => this.onInboxAddItem(text)
					: undefined,
			},
			// Project sections disabled — will be re-added when project feature is enhanced
		];
	}

	private async onInboxAddItem(text: string): Promise<void> {
		const line = `- [ ] ${text}`;
		await this.withSelfWriteGuard(() =>
			addToInbox(this.app.vault, this.plugin.settings, line)
		);
		await this.refresh();
	}

	// ── Panel Drag → Grid ──

	private onPanelDragStart(item: PanelItem, e: PointerEvent): void {
		this.panelDragItem = item;

		// Narrow mode: collapse bottom sheet so grid is visible during drag
		if (this.bottomSheetEl) {
			this.bottomSheetEl.removeClass("expanded");
			this.bottomSheetEl.addClass("collapsed");
		}

		this.boundPanelDragMove = (ev: PointerEvent) => this.onPanelDragMove(ev);
		this.boundPanelDragUp = (ev: PointerEvent) => this.onPanelDragEnd(ev);
		document.addEventListener("pointermove", this.boundPanelDragMove);
		document.addEventListener("pointerup", this.boundPanelDragUp);
	}

	private onPanelDragMove(e: PointerEvent): void {
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

	private async onPanelDragEnd(e: PointerEvent): Promise<void> {
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

		await this.blockActions!.onPanelDragEnd(item, cell);
	}

	private cleanupPanelDrag(): void {
		if (this.boundPanelDragMove) {
			document.removeEventListener("pointermove", this.boundPanelDragMove);
			this.boundPanelDragMove = null;
		}
		if (this.boundPanelDragUp) {
			document.removeEventListener("pointerup", this.boundPanelDragUp);
			this.boundPanelDragUp = null;
		}
	}

	private async onBlockReturnToInbox(item: TimelineItem, fromDay: number): Promise<void> {
		await this.blockActions!.onBlockReturnToInbox(item, fromDay);
	}

	private async deleteBlock(dayIndex: number, item: TimelineItem) {
		await this.blockActions!.deleteBlock(dayIndex, item);
	}

	// ── Block Right-Click Context Menu ──

	private onBlockRightClick(dayIndex: number, item: TimelineItem, event: PointerEvent) {
		const menu = new Menu();

		menu.addItem((menuItem) => {
			menuItem
				.setTitle("Edit")
				.setIcon("pencil")
				.onClick(() => {
					this.onBlockClick(dayIndex, item);
				});
		});

		if (item.checkbox === "plan") {
			menu.addItem((menuItem) => {
				menuItem
					.setTitle("Mark as Done")
					.setIcon("check-circle")
					.onClick(() => {
						this.onBlockComplete(dayIndex, item);
					});
			});
		} else if (item.checkbox === "actual") {
			menu.addItem((menuItem) => {
				menuItem
					.setTitle("Mark as Incomplete")
					.setIcon("circle")
					.onClick(() => {
						this.onBlockUncomplete(dayIndex, item);
					});
			});
		}

		menu.addSeparator();

		menu.addItem((menuItem) => {
			menuItem
				.setTitle("Go to daily note")
				.setIcon("arrow-up-right")
				.onClick(() => {
					this.openDailyNoteAtLine(dayIndex, item.lineNumber);
				});
		});

		menu.addItem((menuItem) => {
			menuItem
				.setTitle("Return to inbox")
				.setIcon("inbox")
				.onClick(() => {
					this.onBlockReturnToInbox(item, dayIndex);
				});
		});

		menu.addItem((menuItem) => {
			menuItem
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => {
					this.deleteBlock(dayIndex, item);
				});
		});

		menu.showAtMouseEvent(event);
	}

	// ── Navigate to source ──

	private async openFileAtLine(path: string, lineNumber?: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file) return;
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file as any);
		if (lineNumber != null) {
			const view = leaf.view as any;
			if (view?.editor) {
				const editor = view.editor;
				editor.setCursor({ line: lineNumber, ch: 0 });
				editor.scrollIntoView(
					{ from: { line: lineNumber, ch: 0 }, to: { line: lineNumber, ch: 0 } },
					true
				);
			}
		}
	}

	private async openDailyNoteAtLine(dayIndex: number, lineNumber?: number) {
		const date = this.dates[dayIndex];
		const path = resolveDailyNotePath(this.plugin.settings.dailyNotePath, date);
		await this.openFileAtLine(path, lineNumber);
	}

	private async navigateToPanelItemSource(item: PanelItem): Promise<void> {
		const src = item.source;
		if (src.type === "inbox") {
			await this.openFileAtLine(src.notePath, src.lineNumber);
		} else if (src.type === "overdue") {
			const date = window.moment(src.dateKey, "YYYY-MM-DD");
			const path = resolveDailyNotePath(this.plugin.settings.dailyNotePath, date);
			await this.openFileAtLine(path, src.lineNumber);
		}
	}

	// ── Block Complete/Uncomplete/Sort (delegated to BlockActions) ──

	private async onBlockComplete(dayIndex: number, item: TimelineItem) {
		await this.blockActions!.onBlockComplete(dayIndex, item);
	}

	private async onBlockUncomplete(dayIndex: number, item: TimelineItem) {
		await this.blockActions!.onBlockUncomplete(dayIndex, item);
	}

	private async sortBlocksCompact() {
		await this.blockActions!.sortBlocksCompact();
	}

	// ── Preset Menu ──

	private showPresetMenu(e: MouseEvent | PointerEvent) {
		showPresetMenu({
			app: this.app,
			settings: this.plugin.settings,
			dates: this.dates,
			weekData: this.weekData,
			event: e,
			guardedSave: (date, items) => this.guardedSave(date, items),
			undoManager: this.undoManager,
			refresh: () => this.refresh(),
			saveSettings: () => this.plugin.saveSettings(),
		});
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
			viewModeOverride: this.viewModeOverride,
		};
	}

	async setState(state: any, result: { history: boolean }): Promise<void> {
		if (typeof state.currentDate === "string") {
			this.currentDate = window.moment(state.currentDate, "YYYY-MM-DD");
		}
		if (state.viewModeOverride === "auto" || state.viewModeOverride === 7 || state.viewModeOverride === 3 || state.viewModeOverride === 1) {
			this.viewModeOverride = state.viewModeOverride;
			if (this.viewModeOverride !== "auto") {
				this.currentVisibleDays = this.viewModeOverride;
			}
		}
		await this.refresh();
	}
}
