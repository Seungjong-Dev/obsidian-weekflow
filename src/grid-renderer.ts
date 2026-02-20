import { moment, setIcon } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { CalendarEvent, Category, TimelineItem, WeekFlowSettings } from "./types";
import { formatTime } from "./parser";
import { isTouchDevice, hapticFeedback } from "./device";

export interface GridCallbacks {
	onCellDragStart: (dayIndex: number, minutes: number) => void;
	onCellDragMove: (dayIndex: number, minutes: number) => void;
	onCellDragEnd: () => void;
	onBlockClick: (dayIndex: number, item: TimelineItem) => void;
	onBlockDragEnd: (item: TimelineItem, fromDay: number, toDay: number, newStart: number) => void;
	onBlockResize: (item: TimelineItem, dayIndex: number, newStart: number, newEnd: number) => void;
	onBlockDropOutside?: (item: TimelineItem, fromDay: number) => void;
	onBlockComplete?: (dayIndex: number, item: TimelineItem) => void;
	onBlockUncomplete?: (dayIndex: number, item: TimelineItem) => void;
	onBlockRightClick?: (dayIndex: number, item: TimelineItem, event: PointerEvent) => void;
	onBlockNavigate?: (dayIndex: number, item: TimelineItem) => void;
	onBlockDelete?: (dayIndex: number, item: TimelineItem) => void;
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
}

type TouchBlockMode = "none" | "selected" | "move" | "delete-confirm";

interface TouchBlockSelection {
	mode: TouchBlockMode;
	dayIndex: number;
	item: TimelineItem;
	originalStart: number;
	originalEnd: number;
	originalDayIndex: number;
	isPenHover: boolean;
	penTapConverted: boolean;
}

interface SelectionRange {
	dayIndex: number;
	startMinutes: number;
	endMinutes: number;
}

type DragMode = "none" | "cell-select" | "block-drag" | "resize";

interface BlockDragState {
	item: TimelineItem;
	fromDay: number;
	startOffset: number; // mouse offset from block start time (minutes)
	lastDay: number;
	lastStart: number;
}

interface ResizeState {
	item: TimelineItem;
	dayIndex: number;
	edge: "left" | "right";
	originalStart: number;
	originalEnd: number;
	currentStart: number;
	currentEnd: number;
}

// Thresholds for distinguishing click vs drag
const DRAG_DELAY_MS = 150;
const TOUCH_DRAG_DELAY_MS = 300;
const DRAG_DISTANCE_PX = 5;

export class GridRenderer {
	private containerEl: HTMLElement;
	private settings: WeekFlowSettings;
	private dates: Moment[];
	private weekData: Map<string, TimelineItem[]>;
	private callbacks: GridCallbacks;
	private gridEl: HTMLElement | null = null;
	private selectionRange: SelectionRange | null = null;
	private selectedBlockId: string | null = null;
	private overlapGroupMap: Map<string, number> = new Map();
	private handleBarElements: Map<number, HTMLElement> = new Map();
	private groupHoverTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

	// Drag state machine
	private dragMode: DragMode = "none";
	private dragAnchorMinutes = 0;

	// Block drag state
	private blockDragState: BlockDragState | null = null;
	private blockDragTimer: ReturnType<typeof setTimeout> | null = null;
	private blockDragStartX = 0;
	private blockDragStartY = 0;
	private lastBlockPointerType: string = "mouse";
	private ghostEls: HTMLElement[] = [];

	// Resize state
	private resizeState: ResizeState | null = null;
	private resizeGhostEls: HTMLElement[] = [];

	// Calendar events overlay
	private calendarEvents: CalendarEvent[] = [];

	// Touch tap-tap state (touch only, replaces drag for cell selection)
	private touchTapState: {
		dayIndex: number;
		minutes: number;
		startX: number;
		startY: number;
		startTime: number;
	} | null = null;

	// Bound handlers for cleanup
	private boundPointerMove: ((e: PointerEvent) => void) | null = null;
	private boundPointerUp: ((e: PointerEvent) => void) | null = null;
	private boundPointerCancel: ((e: PointerEvent) => void) | null = null;

	// Touch swipe lock: prevent Obsidian sidebar from opening during horizontal swipe
	private touchStartX = 0;
	private touchStartY = 0;
	private touchSwipeLocked = false;

	// Longpress state (touch drag)
	private longpressActive = false;
	private longpressEl: HTMLElement | null = null;

	// Custom tooltip
	private tooltipEl: HTMLElement | null = null;
	private tooltipTimer: ReturnType<typeof setTimeout> | null = null;

	// Current time indicator
	private currentTimeEl: HTMLElement | null = null;
	private currentTimeDotEl: HTMLElement | null = null;
	private currentTimeInterval: ReturnType<typeof setInterval> | null = null;

	// Touch block selection
	private touchBlockSelection: TouchBlockSelection | null = null;
	private actionBarEl: HTMLElement | null = null;
	private actionBarHovered = false;

	// Swipe detection state
	private swipeStartX = 0;
	private swipeStartY = 0;
	private swipeStartTime = 0;

	// Responsive layout
	private visibleDays = 7;
	private dayOffset = 0;

	constructor(
		containerEl: HTMLElement,
		settings: WeekFlowSettings,
		dates: Moment[],
		weekData: Map<string, TimelineItem[]>,
		callbacks: GridCallbacks,
	) {
		this.containerEl = containerEl;
		this.settings = settings;
		this.dates = dates;
		this.weekData = weekData;
		this.callbacks = callbacks;
	}

	setVisibleRange(visibleDays: number, dayOffset: number): void {
		this.visibleDays = visibleDays;
		this.dayOffset = dayOffset;
	}

	render(): void {
		this.containerEl.empty();

		this.gridEl = this.containerEl.createDiv({ cls: "weekflow-grid" });
		const totalHours = this.settings.dayEndHour - this.settings.dayStartHour;

		const cols = this.visibleDays * 6;
		this.gridEl.style.gridTemplateColumns =
			`60px repeat(${cols}, 1fr)`;
		this.gridEl.style.gridTemplateRows =
			`auto repeat(${totalHours}, minmax(40px, 1fr))`;

		// ── Header row ──
		const corner = this.gridEl.createDiv({
			cls: "weekflow-header-cell weekflow-corner",
		});
		corner.style.gridColumn = "1";
		corner.style.gridRow = "1";

		for (let i = 0; i < this.visibleDays; i++) {
			const d = this.dayOffset + i; // actual day index in dates[]
			const colStart = i * 6 + 2;
			const date = this.dates[d];
			const headerCell = this.gridEl.createDiv({
				cls: "weekflow-header-cell",
			});
			headerCell.style.gridColumn = `${colStart} / span 6`;
			headerCell.style.gridRow = "1";

			headerCell.createSpan({ text: date.format("ddd"), cls: "weekflow-day-name" });
			headerCell.createSpan({ text: date.format("MM/DD"), cls: "weekflow-day-date" });

			if (date.isSame(window.moment(), "day")) {
				headerCell.addClass("weekflow-today");
			}
		}

		// ── Hour rows with 10-min cells ──
		for (let h = this.settings.dayStartHour; h < this.settings.dayEndHour; h++) {
			const row = (h - this.settings.dayStartHour) + 2;

			const timeLabel = this.gridEl.createDiv({
				cls: "weekflow-time-label",
				text: formatTime(h * 60),
			});
			timeLabel.style.gridColumn = "1";
			timeLabel.style.gridRow = `${row}`;

			for (let i = 0; i < this.visibleDays; i++) {
				const d = this.dayOffset + i;
				const dayColStart = i * 6 + 2;

				for (let slot = 0; slot < 6; slot++) {
					const minutes = h * 60 + slot * 10;
					const col = dayColStart + slot;

					const cell = this.gridEl.createDiv({ cls: "weekflow-cell" });
					cell.style.gridColumn = `${col}`;
					cell.style.gridRow = `${row}`;

					if (slot === 0) cell.addClass("weekflow-cell-day-start");

					cell.dataset.day = String(d);
					cell.dataset.minutes = String(minutes);

					// Cell pointerdown → start cell selection (only if no block drag in progress)
					cell.addEventListener("pointerdown", (e) => {
						if (this.dragMode !== "none") return;

						if (e.pointerType === "touch") {
							// Deselect touch block selection (unless in move mode)
							if (this.touchBlockSelection && this.touchBlockSelection.mode !== "move") {
								this.clearTouchBlockSelection();
							}
							// Touch: tap-tap mode — no preventDefault() (allow scroll)
							this.deselectOverlapBlock();
							this.touchTapState = {
								dayIndex: d,
								minutes,
								startX: e.clientX,
								startY: e.clientY,
								startTime: Date.now(),
							};
						} else {
							// Mouse: existing drag selection
							e.preventDefault();
							this.deselectOverlapBlock();
							this.swipeStartX = e.clientX;
							this.swipeStartY = e.clientY;
							this.swipeStartTime = Date.now();
							this.dragMode = "cell-select";
							this.dragAnchorMinutes = minutes;
							this.selectionRange = {
								dayIndex: d,
								startMinutes: minutes,
								endMinutes: minutes + 10,
							};
							this.updateSelectionHighlight();
							this.callbacks.onCellDragStart(d, minutes);
						}
					});

					cell.addEventListener("pointerenter", () => {
						if (this.dragMode !== "cell-select" || !this.selectionRange) return;
						if (this.selectionRange.dayIndex !== d) return;

						const lo = Math.min(this.dragAnchorMinutes, minutes);
						const hi = Math.max(this.dragAnchorMinutes, minutes) + 10;
						this.selectionRange.startMinutes = lo;
						this.selectionRange.endMinutes = hi;
						this.updateSelectionHighlight();
						this.callbacks.onCellDragMove(d, minutes);
					});
				}
			}
		}

		// Block Obsidian sidebar swipe: stop horizontal touch propagation on the grid
		this.gridEl.addEventListener("touchstart", (e) => {
			if (e.touches.length !== 1) return;
			this.touchStartX = e.touches[0].clientX;
			this.touchStartY = e.touches[0].clientY;
			this.touchSwipeLocked = false;
		}, { passive: true });

		this.gridEl.addEventListener("touchmove", (e) => {
			if (e.touches.length !== 1) return;
			const dx = e.touches[0].clientX - this.touchStartX;
			const dy = e.touches[0].clientY - this.touchStartY;
			if (!this.touchSwipeLocked && Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
				this.touchSwipeLocked = true;
			}
			if (this.touchSwipeLocked) {
				e.stopPropagation();
			}
		}, { passive: true });

		// Global pointer handlers
		this.boundPointerMove = (e: PointerEvent) => this.onGlobalPointerMove(e);
		this.boundPointerUp = (e: PointerEvent) => this.onGlobalPointerUp(e);
		this.boundPointerCancel = (e: PointerEvent) => this.onGlobalPointerCancel(e);
		document.addEventListener("pointermove", this.boundPointerMove);
		document.addEventListener("pointerup", this.boundPointerUp);
		document.addEventListener("pointercancel", this.boundPointerCancel);

		this.renderBlocks();
		this.renderCalendarOverlay();

		// Current time indicator
		if (this.currentTimeInterval) {
			clearInterval(this.currentTimeInterval);
		}
		requestAnimationFrame(() => this.renderCurrentTimeIndicator());
		this.currentTimeInterval = setInterval(() => this.renderCurrentTimeIndicator(), 60000);

		// Restore touch block selection after re-render
		if (this.touchBlockSelection) {
			const blockEl = this.findBlockElement(this.touchBlockSelection.item.id);
			if (blockEl) {
				this.updateTouchBlockSelectionStyles();
				this.showActionBar(this.touchBlockSelection.dayIndex, this.touchBlockSelection.item, blockEl);
			} else {
				this.clearTouchBlockSelection();
			}
		}
	}

	setCalendarEvents(events: CalendarEvent[]): void {
		this.calendarEvents = events;
	}

	renderCalendarOverlayOnly(): void {
		if (!this.gridEl) return;
		this.gridEl.querySelectorAll(".weekflow-calendar-event").forEach((el) => el.remove());
		this.renderCalendarOverlay();
	}

	destroy(): void {
		if (this.currentTimeInterval) {
			clearInterval(this.currentTimeInterval);
			this.currentTimeInterval = null;
		}
		if (this.currentTimeEl) {
			this.currentTimeEl.remove();
			this.currentTimeEl = null;
		}
		if (this.currentTimeDotEl) {
			this.currentTimeDotEl.remove();
			this.currentTimeDotEl = null;
		}
		if (this.boundPointerMove) {
			document.removeEventListener("pointermove", this.boundPointerMove);
		}
		if (this.boundPointerUp) {
			document.removeEventListener("pointerup", this.boundPointerUp);
		}
		if (this.boundPointerCancel) {
			document.removeEventListener("pointercancel", this.boundPointerCancel);
		}
		this.clearTouchBlockSelection();
		this.hideTooltip();
	}

	// ── Tooltip ──

	private showTooltip(text: string, anchorEl: HTMLElement): void {
		this.hideTooltip();
		const tip = document.createElement("div");
		tip.className = "weekflow-tooltip";
		tip.textContent = text;
		document.body.appendChild(tip);
		this.tooltipEl = tip;

		const rect = anchorEl.getBoundingClientRect();
		tip.style.left = `${rect.left + rect.width / 2}px`;
		tip.style.top = `${rect.top}px`;

		// Clamp to viewport after rendering
		requestAnimationFrame(() => {
			if (!this.tooltipEl) return;
			const tipRect = tip.getBoundingClientRect();
			if (tipRect.left < 4) {
				tip.style.left = `${4 + tipRect.width / 2}px`;
			} else if (tipRect.right > window.innerWidth - 4) {
				tip.style.left = `${window.innerWidth - 4 - tipRect.width / 2}px`;
			}
			if (tipRect.top < 4) {
				// Show below the block instead
				tip.style.top = `${rect.bottom}px`;
				tip.style.transform = "translateX(-50%) translateY(4px)";
			}
		});
	}

	private hideTooltip(): void {
		if (this.tooltipTimer) {
			clearTimeout(this.tooltipTimer);
			this.tooltipTimer = null;
		}
		if (this.tooltipEl) {
			this.tooltipEl.remove();
			this.tooltipEl = null;
		}
	}

	// ── Global Pointer Handlers ──

	private onGlobalPointerMove(e: PointerEvent) {
		if (this.dragMode === "cell-select" && this.selectionRange) {
			const cell = this.getCellFromPoint(e.clientX, e.clientY);
			if (cell && cell.dayIndex === this.selectionRange.dayIndex) {
				const lo = Math.min(this.dragAnchorMinutes, cell.minutes);
				const hi = Math.max(this.dragAnchorMinutes, cell.minutes) + 10;
				this.selectionRange.startMinutes = lo;
				this.selectionRange.endMinutes = hi;
				this.updateSelectionHighlight();
				this.callbacks.onCellDragMove(cell.dayIndex, cell.minutes);
			}
		} else if (this.dragMode === "block-drag" && this.blockDragState) {
			this.onBlockDragMove(e);
		} else if (this.dragMode === "resize" && this.resizeState) {
			this.onResizeDragMove(e);
		}
	}

	private onGlobalPointerUp(e: PointerEvent) {
		this.hideTooltip();

		// Clear longpress visual feedback
		if (this.longpressActive && this.longpressEl) {
			this.longpressEl.removeClass("weekflow-longpress-active");
			this.longpressActive = false;
			this.longpressEl = null;
		}

		if (this.dragMode === "cell-select") {
			// Check for swipe gesture
			this.checkSwipe(e);
			this.dragMode = "none";
			this.callbacks.onCellDragEnd();
		} else if (this.dragMode === "block-drag") {
			this.onBlockDragFinish(e);
		} else if (this.dragMode === "resize") {
			this.onResizeDragFinish(e);
		}

		// Clear pending block drag timer
		if (this.blockDragTimer) {
			clearTimeout(this.blockDragTimer);
			this.blockDragTimer = null;
		}

		// Touch tap-tap handling
		if (this.touchTapState) {
			this.handleTouchPointerUp(e);
		}
	}

	private onGlobalPointerCancel(e: PointerEvent) {
		this.hideTooltip();

		// Check for swipe before discarding touch state
		// (browser fires pointercancel during pan-y scroll, but horizontal swipe data is still valid)
		if (this.touchTapState) {
			const state = this.touchTapState;
			this.touchTapState = null;

			const dx = e.clientX - state.startX;
			const dy = e.clientY - state.startY;
			const dt = Date.now() - state.startTime;
			const absDx = Math.abs(dx);
			const absDy = Math.abs(dy);

			if (absDx > 50 && absDx > absDy * 2 && dt < 300) {
				this.clearSelection();
				if (dx < 0 && this.callbacks.onSwipeLeft) this.callbacks.onSwipeLeft();
				else if (dx > 0 && this.callbacks.onSwipeRight) this.callbacks.onSwipeRight();
			}
		}

		// Reset drag state — prevents stale cell-select/block-drag/resize from
		// persisting after pointercancel (e.g. Apple Pencil lift, palm rejection)
		if (this.dragMode !== "none") {
			this.dragMode = "none";
			this.clearSelection();
		}

		// Clear pending block drag timer
		if (this.blockDragTimer) {
			clearTimeout(this.blockDragTimer);
			this.blockDragTimer = null;
		}

		if (this.longpressActive && this.longpressEl) {
			this.longpressEl.removeClass("weekflow-longpress-active");
			this.longpressActive = false;
			this.longpressEl = null;
		}
	}

	private handleTouchPointerUp(e: PointerEvent) {
		if (!this.touchTapState) return;
		const state = this.touchTapState;
		this.touchTapState = null;

		const dx = e.clientX - state.startX;
		const dy = e.clientY - state.startY;
		const dt = Date.now() - state.startTime;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);

		// Swipe detection (>50px, |dx|>|dy|*2, <300ms)
		if (absDx > 50 && absDx > absDy * 2 && dt < 300) {
			this.clearSelection();
			if (dx < 0 && this.callbacks.onSwipeLeft) this.callbacks.onSwipeLeft();
			else if (dx > 0 && this.callbacks.onSwipeRight) this.callbacks.onSwipeRight();
			return;
		}

		// If finger moved too much, it was a scroll — not a tap
		if (absDx > 10 || absDy > 10) return;

		// Treat as tap
		this.handleCellTap(state.dayIndex, state.minutes);
	}

	private handleCellTap(dayIndex: number, minutes: number) {
		if (this.selectionRange && this.selectionRange.dayIndex === dayIndex) {
			// Second tap (same day): extend range → open modal
			const lo = Math.min(this.dragAnchorMinutes, minutes);
			const hi = Math.max(this.dragAnchorMinutes, minutes) + 10;
			this.selectionRange.startMinutes = lo;
			this.selectionRange.endMinutes = hi;
			this.updateSelectionHighlight();
			this.callbacks.onCellDragEnd();
		} else {
			// First tap (or different day): set anchor
			this.clearSelection();
			this.dragAnchorMinutes = minutes;
			this.selectionRange = {
				dayIndex,
				startMinutes: minutes,
				endMinutes: minutes + 10,
			};
			this.updateSelectionHighlight();
		}
	}

	// ── Swipe Detection ──

	private checkSwipe(e: PointerEvent): void {
		const dx = e.clientX - this.swipeStartX;
		const dy = e.clientY - this.swipeStartY;
		const dt = Date.now() - this.swipeStartTime;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);

		// Swipe criteria: >50px horizontal, horizontal > vertical*2, <300ms
		if (absDx > 50 && absDx > absDy * 2 && dt < 300) {
			if (dx < 0 && this.callbacks.onSwipeLeft) {
				this.callbacks.onSwipeLeft();
			} else if (dx > 0 && this.callbacks.onSwipeRight) {
				this.callbacks.onSwipeRight();
			}
		}
	}

	// ── Cell Selection Highlight ──

	private updateSelectionHighlight(): void {
		if (!this.gridEl) return;

		this.gridEl
			.querySelectorAll(".weekflow-cell-selected")
			.forEach((el) => el.removeClass("weekflow-cell-selected"));

		if (!this.selectionRange) return;

		const { dayIndex, startMinutes, endMinutes } = this.selectionRange;
		this.gridEl.querySelectorAll(".weekflow-cell").forEach((el) => {
			const cellEl = el as HTMLElement;
			const d = parseInt(cellEl.dataset.day || "-1");
			const m = parseInt(cellEl.dataset.minutes || "-1");
			if (d === dayIndex && m >= startMinutes && m < endMinutes) {
				cellEl.addClass("weekflow-cell-selected");
			}
		});
	}

	clearSelection(): void {
		this.selectionRange = null;
		this.dragMode = "none";
		if (this.gridEl) {
			this.gridEl
				.querySelectorAll(".weekflow-cell-selected")
				.forEach((el) => el.removeClass("weekflow-cell-selected"));
		}
	}

	getSelection(): SelectionRange | null {
		return this.selectionRange;
	}

	// ── Public API for external drag (Panel→Grid) ──

	public getGridCellFromPoint(x: number, y: number): { dayIndex: number; minutes: number } | null {
		return this.getCellFromPoint(x, y);
	}

	private externalGhostEls: HTMLElement[] = [];

	public renderExternalGhost(dayIndex: number, startMin: number, endMin: number, color: string, label: string): void {
		this.removeExternalGhost();
		if (!this.gridEl) return;

		const dayStartMin = this.settings.dayStartHour * 60;
		const dayEndMin = this.settings.dayEndHour * 60;

		const clampedStart = Math.max(dayStartMin, Math.round(startMin / 10) * 10);
		const clampedEnd = Math.min(dayEndMin, Math.round(endMin / 10) * 10);
		if (clampedEnd <= clampedStart) return;

		const startOffset = clampedStart - dayStartMin;
		const endOffset = clampedEnd - dayStartMin;
		const dayColStart = (dayIndex - this.dayOffset) * 6 + 2;
		const segments = this.getHourSegments(startOffset, endOffset);

		const widestIdx = segments.reduce((best, seg, idx) => {
			const w = seg.slotEnd - seg.slotStart;
			const bw = segments[best].slotEnd - segments[best].slotStart;
			return w > bw ? idx : best;
		}, 0);

		segments.forEach((seg, i) => {
			const ghost = this.gridEl!.createDiv({ cls: "weekflow-block-ghost" });
			ghost.style.gridRow = `${seg.row}`;
			ghost.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			ghost.style.backgroundColor = color + "40";
			ghost.style.borderColor = color;
			if (i === widestIdx) ghost.setText(label);
			this.externalGhostEls.push(ghost);
		});
	}

	public removeExternalGhost(): void {
		for (const el of this.externalGhostEls) el.remove();
		this.externalGhostEls = [];
	}

	// ── getCellFromPoint ──

	/**
	 * Convert mouse coordinates to {dayIndex, minutes} using grid geometry math.
	 * Avoids iterating all cells and calling getBoundingClientRect() on each.
	 */
	private getCellFromPoint(clientX: number, clientY: number): { dayIndex: number; minutes: number } | null {
		if (!this.gridEl) return null;

		const gridRect = this.gridEl.getBoundingClientRect();
		// getBoundingClientRect() already reflects container scroll position,
		// so no need to add containerEl.scrollLeft/Top (would double-count)
		const x = clientX - gridRect.left;
		const y = clientY - gridRect.top;

		// Column layout: 60px time label + visibleDays*6 equal slots
		const timeLabelWidth = 60;
		if (x < timeLabelWidth) return null;

		const totalSlots = this.visibleDays * 6;
		const slotsWidth = gridRect.width - timeLabelWidth;
		if (slotsWidth <= 0) return null;

		const slotWidth = slotsWidth / totalSlots;
		const slotIndex = Math.floor((x - timeLabelWidth) / slotWidth);
		if (slotIndex < 0 || slotIndex >= totalSlots) return null;

		const dayIndex = this.dayOffset + Math.floor(slotIndex / 6);
		const slotInDay = slotIndex % 6;

		// Row layout: header row (auto height) + hour rows
		// Find header height from the first header cell
		const headerCell = this.gridEl.querySelector(".weekflow-header-cell");
		if (!headerCell) return null;
		const headerHeight = (headerCell as HTMLElement).getBoundingClientRect().height;

		const bodyY = y - headerHeight;
		if (bodyY < 0) return null;

		const totalHours = this.settings.dayEndHour - this.settings.dayStartHour;
		const bodyHeight = gridRect.height - headerHeight;
		if (bodyHeight <= 0) return null;

		const rowHeight = bodyHeight / totalHours;
		const hourIndex = Math.floor(bodyY / rowHeight);
		if (hourIndex < 0 || hourIndex >= totalHours) return null;

		const hour = this.settings.dayStartHour + hourIndex;
		const minutes = hour * 60 + slotInDay * 10;

		return { dayIndex, minutes };
	}

	// ── Block Rendering ──

	private renderBlocks(): void {
		if (!this.gridEl) return;

		this.computeOverlapGroups();

		for (let i = 0; i < this.visibleDays; i++) {
			const d = this.dayOffset + i;
			const dateKey = this.dates[d].format("YYYY-MM-DD");
			const items = this.weekData.get(dateKey) || [];

			for (const item of items) {
				this.renderBlock(d, item);
			}

			this.renderOverlapHandlesForDay(d, items);
		}
	}

	private getHourSegments(
		startOffset: number,
		endOffset: number
	): { row: number; slotStart: number; slotEnd: number }[] {
		const startHour = Math.floor(startOffset / 60);
		const lastHour = Math.floor((endOffset - 1) / 60);
		const segments: { row: number; slotStart: number; slotEnd: number }[] = [];

		for (let h = startHour; h <= lastHour; h++) {
			const hourStartMin = h * 60;
			const hourEndMin = hourStartMin + 60;

			const segStart = Math.max(startOffset, hourStartMin);
			const segEnd = Math.min(endOffset, hourEndMin);

			const slotStart = Math.floor((segStart - hourStartMin) / 10);
			const slotEnd = Math.ceil((segEnd - hourStartMin) / 10);

			segments.push({
				row: h + 2,
				slotStart,
				slotEnd: Math.min(slotEnd, 6),
			});
		}

		return segments;
	}

	private renderBlock(dayIndex: number, item: TimelineItem): void {
		if (!this.gridEl) return;

		const displayTime =
			item.checkbox === "actual" && item.actualTime
				? item.actualTime
				: item.planTime;

		const dayStartMin = this.settings.dayStartHour * 60;
		const dayEndMin = this.settings.dayEndHour * 60;
		const startOffset = displayTime.start - dayStartMin;
		const endOffset = displayTime.end - dayStartMin;

		if (startOffset < 0 || endOffset > (dayEndMin - dayStartMin)) return;

		const visibleIndex = dayIndex - this.dayOffset;
		const dayColStart = visibleIndex * 6 + 2;
		const segments = this.getHourSegments(startOffset, endOffset);
		if (segments.length === 0) return;

		const color = this.getCategoryColor(item.tags);
		const isOverlap = this.overlapGroupMap.has(item.id);
		const has5minStart = startOffset % 10 !== 0;
		const has5minEnd = endOffset % 10 !== 0;

		// Put content text in the widest segment to avoid row height expansion
		const widestIdx = segments.reduce((best, seg, idx) => {
			const w = seg.slotEnd - seg.slotStart;
			const bw = segments[best].slotEnd - segments[best].slotStart;
			return w > bw ? idx : best;
		}, 0);

		const tooltipTime = `${formatTime(item.planTime.start)}-${formatTime(item.planTime.end)}`;
		const tooltipText = `${tooltipTime} ${item.content}`;

		segments.forEach((seg, i) => {
			const block = this.gridEl!.createDiv({ cls: "weekflow-block" });
			block.style.gridRow = `${seg.row} / ${seg.row + 1}`;
			block.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			block.style.position = "absolute";
			block.style.inset = "0";
			block.dataset.itemId = item.id;

			// Overlap styling
			if (isOverlap) {
				block.addClass("weekflow-block-overlap");
				const groupIdx = this.overlapGroupMap.get(item.id)!;
				block.dataset.overlapGroup = String(groupIdx);
				const selectedGroup = this.selectedBlockId !== null
					? this.overlapGroupMap.get(this.selectedBlockId) : undefined;
				if (this.selectedBlockId === item.id) {
					block.addClass("weekflow-block-selected");
				} else if (selectedGroup !== undefined &&
					this.overlapGroupMap.get(item.id) === selectedGroup) {
					block.addClass("weekflow-block-dimmed");
				}
				block.addEventListener("pointerenter", () => this.showGroupHandles(groupIdx));
				block.addEventListener("pointerleave", () => this.scheduleHideGroupHandles(groupIdx));
			}

			// Style based on checkbox state
			if (item.checkbox === "plan") {
				block.addClass("weekflow-block-plan");
				block.style.borderColor = color;
				block.style.color = color;
			} else if (item.checkbox === "actual") {
				block.addClass("weekflow-block-actual");
				block.style.backgroundColor = color + "40";
				block.style.borderColor = color;
				block.style.color = color;
			} else if (item.checkbox === "deferred") {
				block.addClass("weekflow-block-deferred");
				block.style.borderColor = color + "80";
				block.style.color = color + "80";
			}

			// Connected segments
			if (segments.length > 1) {
				if (i < segments.length - 1) block.addClass("weekflow-block-cont-right");
				if (i > 0) block.addClass("weekflow-block-cont-left");
			}

			// 5-minute diagonal edges
			const slots = seg.slotEnd - seg.slotStart;
			if (i === 0 && has5minStart) {
				block.addClass("weekflow-5min-start");
				block.style.setProperty("--slots", String(slots));
			}
			if (i === segments.length - 1 && has5minEnd) {
				block.addClass("weekflow-5min-end");
				block.style.setProperty("--slots", String(slots));
			}

			// Content text in widest segment
			if (i === widestIdx) {
				const contentEl = block.createDiv({ cls: "weekflow-block-content" });
				contentEl.setText(item.content);

				const timeEl = block.createDiv({ cls: "weekflow-block-time" });
				timeEl.setText(
					`${formatTime(item.planTime.start)}-${formatTime(item.planTime.end)}`
				);
			}

			// Toggle button in last segment
			if (i === segments.length - 1) {
				if (item.checkbox === "plan" && this.callbacks.onBlockComplete) {
					const toggleBtn = block.createDiv({ cls: "weekflow-block-toggle" });
					toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
					toggleBtn.ariaLabel = "Mark as done";
					const completeCb = this.callbacks.onBlockComplete;
					toggleBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
					toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); completeCb(dayIndex, item); });
				} else if (item.checkbox === "actual" && this.callbacks.onBlockUncomplete) {
					const toggleBtn = block.createDiv({ cls: "weekflow-block-toggle" });
					toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
					toggleBtn.ariaLabel = "Mark as incomplete";
					const uncompleteCb = this.callbacks.onBlockUncomplete;
					toggleBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
					toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); uncompleteCb(dayIndex, item); });
				}

				// Navigation icon
				if (this.callbacks.onBlockNavigate) {
					const navBtn = block.createDiv({ cls: "weekflow-block-nav" });
					setIcon(navBtn, "arrow-up-right");
					navBtn.ariaLabel = "Go to daily note";
					const navCb = this.callbacks.onBlockNavigate;
					navBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
					navBtn.addEventListener("click", (e) => { e.stopPropagation(); navCb(dayIndex, item); });
				}
			}

			// ── Resize Handles ──
			// Left handle on first segment (drag start time)
			if (i === 0) {
				const leftHandle = block.createDiv({ cls: "weekflow-resize-handle weekflow-resize-left" });
				leftHandle.addEventListener("pointerdown", (e) => {
					// Touch: only allow resize in move mode
					if (e.pointerType === "touch" && this.touchBlockSelection?.mode !== "move") return;
					e.preventDefault();
					e.stopPropagation();
					leftHandle.setPointerCapture(e.pointerId);
					this.startResize(item, dayIndex, "left", e);
				});
			}

			// Right handle on last segment (drag end time)
			if (i === segments.length - 1) {
				const rightHandle = block.createDiv({ cls: "weekflow-resize-handle weekflow-resize-right" });
				rightHandle.addEventListener("pointerdown", (e) => {
					// Touch: only allow resize in move mode
					if (e.pointerType === "touch" && this.touchBlockSelection?.mode !== "move") return;
					e.preventDefault();
					e.stopPropagation();
					rightHandle.setPointerCapture(e.pointerId);
					this.startResize(item, dayIndex, "right", e);
				});
			}

			// ── Block pointerdown: click vs drag detection ──
			block.addEventListener("pointerdown", (e) => {
				this.lastBlockPointerType = e.pointerType;

				if (e.pointerType === "touch") {
					e.stopPropagation();
					this.blockDragStartX = e.clientX;
					this.blockDragStartY = e.clientY;

					// Move mode: selected block → immediate drag
					if (this.touchBlockSelection?.mode === "move"
						&& this.touchBlockSelection.item.id === item.id) {
						e.preventDefault();
						const cell = this.getCellFromPoint(e.clientX, e.clientY);
						const dragTime = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
						const offsetMinutes = cell ? (cell.minutes - dragTime.start) : 0;
						this.dragMode = "block-drag";
						this.blockDragState = {
							item, fromDay: dayIndex,
							startOffset: Math.max(0, offsetMinutes),
							lastDay: -1, lastStart: -1,
						};
						try { block.setPointerCapture(e.pointerId); } catch { /* */ }
					}
					return; // Touch: handle selection in click event
				}

				// Mouse/pen: existing logic
				e.preventDefault();
				e.stopPropagation();

				this.blockDragStartX = e.clientX;
				this.blockDragStartY = e.clientY;

				const cell = this.getCellFromPoint(e.clientX, e.clientY);
				const dragTime = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
				const offsetMinutes = cell ? (cell.minutes - dragTime.start) : 0;

				const delay = DRAG_DELAY_MS;
				const targetBlock = block;
				const pointerId = e.pointerId;

				// Start a timer for drag threshold
				this.blockDragTimer = setTimeout(() => {
					this.blockDragTimer = null;
					this.dragMode = "block-drag";
					this.blockDragState = {
						item,
						fromDay: dayIndex,
						startOffset: Math.max(0, offsetMinutes),
						lastDay: -1,
						lastStart: -1,
					};

					try { targetBlock.setPointerCapture(pointerId); } catch { /* pointer may be gone */ }

					this.updateGhostPosition(e);
				}, delay);
			});

			block.addEventListener("click", (e) => {
				e.stopPropagation();
				const dx = e.clientX - this.blockDragStartX;
				const dy = e.clientY - this.blockDragStartY;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= DRAG_DISTANCE_PX) return;

				if (this.lastBlockPointerType === "touch" || this.lastBlockPointerType === "pen") {
					// Touch and Apple Pencil: use selection mode
					this.handleTouchBlockTap(dayIndex, item, block);
				} else {
					if (this.dragMode === "none") {
						this.callbacks.onBlockClick(dayIndex, item);
					}
				}
			});

			block.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (this.lastBlockPointerType === "touch") return;
				if (this.callbacks.onBlockRightClick) {
					this.callbacks.onBlockRightClick(dayIndex, item, e as unknown as PointerEvent);
				}
			});

			// Tooltip: mouse/pen hover + Apple Pencil hover selection
			block.addEventListener("pointerenter", (e) => {
				if (e.pointerType === "touch") return;
				if (e.pointerType === "pen") {
					// Apple Pencil hover → transient selection
					if (!this.touchBlockSelection || this.touchBlockSelection.item.id !== item.id) {
						this.clearTouchBlockSelection();
						const dragTime = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
						this.touchBlockSelection = {
							mode: "selected", dayIndex, item,
							originalStart: dragTime.start, originalEnd: dragTime.end,
							originalDayIndex: dayIndex,
							isPenHover: true, penTapConverted: false,
						};
						this.updateTouchBlockSelectionStyles();
						this.showActionBar(dayIndex, item, block);
					}
				}
				this.tooltipTimer = setTimeout(() => {
					this.showTooltip(tooltipText, block);
				}, 300);
			});
			block.addEventListener("pointerleave", (e) => {
				if (e.pointerType === "touch") return;
				if (e.pointerType === "pen"
					&& this.touchBlockSelection?.isPenHover
					&& !this.touchBlockSelection?.penTapConverted) {
					// Delay clearing so a pen tap (pointerleave → click) or
					// moving to action bar can keep the selection alive
					setTimeout(() => {
						if (this.touchBlockSelection?.isPenHover
							&& !this.touchBlockSelection?.penTapConverted
							&& !this.actionBarHovered) {
							this.clearTouchBlockSelection();
						}
					}, 150);
				}
				this.hideTooltip();
			});
		});

		// Plan outline when plan ≠ actual
		if (item.checkbox === "actual" && item.actualTime) {
			const p = item.planTime;
			const a = item.actualTime;
			const overlaps = p.start < a.end && a.start < p.end;
			this.renderPlanOutline(dayIndex, item, !overlaps);
		}
	}

	// ── Block Drag ──

	private updateGhostPosition(e: PointerEvent | MouseEvent) {
		if (!this.blockDragState || !this.gridEl) return;

		const cell = this.getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;

		const item = this.blockDragState.item;
		const dragTime = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
		const duration = dragTime.end - dragTime.start;
		const newStart = Math.max(
			this.settings.dayStartHour * 60,
			cell.minutes - this.blockDragState.startOffset
		);
		const snappedStart = Math.round(newStart / 10) * 10;

		// Skip if nothing changed
		if (cell.dayIndex === this.blockDragState.lastDay && snappedStart === this.blockDragState.lastStart) return;
		this.blockDragState.lastDay = cell.dayIndex;
		this.blockDragState.lastStart = snappedStart;

		const snappedEnd = snappedStart + duration;
		const dayStartMin = this.settings.dayStartHour * 60;
		const startOffset = snappedStart - dayStartMin;
		const endOffset = snappedEnd - dayStartMin;

		const dayColStart = (cell.dayIndex - this.dayOffset) * 6 + 2;
		const segments = this.getHourSegments(startOffset, endOffset);
		if (segments.length === 0) return;

		const color = this.getCategoryColor(item.tags);
		this.renderGhostSegments(segments, dayColStart, color, item.content);
	}

	private removeGhost() {
		for (const el of this.ghostEls) el.remove();
		this.ghostEls = [];
	}

	/**
	 * Render ghost block segments spanning all hour rows.
	 */
	private renderGhostSegments(
		segments: { row: number; slotStart: number; slotEnd: number }[],
		dayColStart: number,
		color: string,
		label: string
	) {
		this.removeGhost();
		if (!this.gridEl) return;

		const widestIdx = segments.reduce((best, seg, idx) => {
			const w = seg.slotEnd - seg.slotStart;
			const bw = segments[best].slotEnd - segments[best].slotStart;
			return w > bw ? idx : best;
		}, 0);

		segments.forEach((seg, i) => {
			const ghost = this.gridEl!.createDiv({ cls: "weekflow-block-ghost" });
			ghost.style.gridRow = `${seg.row}`;
			ghost.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			ghost.style.backgroundColor = color + "40";
			ghost.style.borderColor = color;
			if (i === widestIdx) ghost.setText(label);
			this.ghostEls.push(ghost);
		});
	}

	private onBlockDragMove(e: PointerEvent) {
		// Check if we've moved enough to confirm drag
		const dx = e.clientX - this.blockDragStartX;
		const dy = e.clientY - this.blockDragStartY;
		if (Math.abs(dx) < DRAG_DISTANCE_PX && Math.abs(dy) < DRAG_DISTANCE_PX) return;

		this.hideTooltip();
		this.updateGhostPosition(e);
	}

	private onBlockDragFinish(e: PointerEvent) {
		if (this.touchBlockSelection?.mode === "move") {
			// Move mode: keep ghost and blockDragState — wait for confirm/cancel
			const cell = this.getCellFromPoint(e.clientX, e.clientY);
			if (cell && this.blockDragState) {
				const newStart = Math.round(
					Math.max(this.settings.dayStartHour * 60,
						cell.minutes - this.blockDragState.startOffset) / 10
				) * 10;
				this.blockDragState.lastDay = cell.dayIndex;
				this.blockDragState.lastStart = newStart;
			}
			this.dragMode = "none";
			// Re-show move action bar at updated block position
			const blockEl = this.touchBlockSelection.item.id
				? this.findBlockElement(this.touchBlockSelection.item.id)
				: null;
			if (blockEl) this.showMoveActionBar(blockEl);
			return;
		}

		this.dragMode = "none";
		this.removeGhost();

		if (!this.blockDragState) return;

		const cell = this.getCellFromPoint(e.clientX, e.clientY);
		if (!cell) {
			// Dropped outside the grid — check for panel drop target
			const item = this.blockDragState.item;
			const fromDay = this.blockDragState.fromDay;
			this.blockDragState = null;

			// Check if the drag actually moved (not just a click)
			const dx = e.clientX - this.blockDragStartX;
			const dy = e.clientY - this.blockDragStartY;
			if (Math.sqrt(dx * dx + dy * dy) >= DRAG_DISTANCE_PX && this.callbacks.onBlockDropOutside) {
				this.callbacks.onBlockDropOutside(item, fromDay);
			}
			return;
		}

		const item = this.blockDragState.item;
		const fromDay = this.blockDragState.fromDay;
		const newStart = Math.max(
			this.settings.dayStartHour * 60,
			cell.minutes - this.blockDragState.startOffset
		);
		const snappedStart = Math.round(newStart / 10) * 10;

		this.blockDragState = null;

		// Only trigger if position actually changed
		const dragTime = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
		if (cell.dayIndex === fromDay && snappedStart === dragTime.start) return;

		this.callbacks.onBlockDragEnd(item, fromDay, cell.dayIndex, snappedStart);
	}

	// ── Resize ──

	private startResize(item: TimelineItem, dayIndex: number, edge: "left" | "right", e: PointerEvent) {
		this.dragMode = "resize";
		const time = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
		this.resizeState = {
			item,
			dayIndex,
			edge,
			originalStart: time.start,
			originalEnd: time.end,
			currentStart: time.start,
			currentEnd: time.end,
		};
	}

	private onResizeDragMove(e: PointerEvent) {
		if (!this.resizeState || !this.gridEl) return;

		const cell = this.getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;
		if (cell.dayIndex !== this.resizeState.dayIndex) return;

		const snappedMinutes = Math.round(cell.minutes / 10) * 10;

		let newStart = this.resizeState.originalStart;
		let newEnd = this.resizeState.originalEnd;

		if (this.resizeState.edge === "left") {
			newStart = Math.min(snappedMinutes, newEnd - 10);
		} else {
			newEnd = Math.max(snappedMinutes + 10, newStart + 10);
		}

		// Clamp to day bounds
		const dayStartMin = this.settings.dayStartHour * 60;
		const dayEndMin = this.settings.dayEndHour * 60;
		newStart = Math.max(dayStartMin, newStart);
		newEnd = Math.min(dayEndMin, newEnd);

		if (newEnd <= newStart) return;

		// Skip if nothing changed
		if (newStart === this.resizeState.currentStart && newEnd === this.resizeState.currentEnd) return;

		// Update tracked values
		this.resizeState.currentStart = newStart;
		this.resizeState.currentEnd = newEnd;

		// Render all ghost segments
		const color = this.getCategoryColor(this.resizeState.item.tags);
		const dayColStart = (this.resizeState.dayIndex - this.dayOffset) * 6 + 2;
		const startOffset = newStart - dayStartMin;
		const endOffset = newEnd - dayStartMin;
		const segments = this.getHourSegments(startOffset, endOffset);

		this.removeResizeGhost();
		const label = `${formatTime(newStart)}-${formatTime(newEnd)}`;
		const widestIdx = segments.reduce((best, seg, idx) => {
			const w = seg.slotEnd - seg.slotStart;
			const bw = segments[best].slotEnd - segments[best].slotStart;
			return w > bw ? idx : best;
		}, 0);
		segments.forEach((seg, i) => {
			const ghost = this.gridEl!.createDiv({ cls: "weekflow-block-ghost" });
			ghost.style.gridRow = `${seg.row}`;
			ghost.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			ghost.style.backgroundColor = color + "30";
			ghost.style.borderColor = color;
			if (i === widestIdx) ghost.setText(label);
			this.resizeGhostEls.push(ghost);
		});
	}

	private removeResizeGhost() {
		for (const el of this.resizeGhostEls) el.remove();
		this.resizeGhostEls = [];
	}

	private onResizeDragFinish(e: PointerEvent) {
		if (this.touchBlockSelection?.mode === "move") {
			// Move mode: keep resize ghost and resizeState — wait for confirm/cancel
			this.dragMode = "none";
			const blockEl = this.touchBlockSelection.item.id
				? this.findBlockElement(this.touchBlockSelection.item.id)
				: null;
			if (blockEl) this.showMoveActionBar(blockEl);
			return;
		}

		this.dragMode = "none";
		this.removeResizeGhost();

		if (!this.resizeState) return;

		const { currentStart: newStart, currentEnd: newEnd } = this.resizeState;
		const state = this.resizeState;
		this.resizeState = null;

		// Only trigger if actually changed
		if (newStart === state.originalStart && newEnd === state.originalEnd) return;
		if (newEnd <= newStart) return;

		this.callbacks.onBlockResize(state.item, state.dayIndex, newStart, newEnd);
	}

	// ── Plan Outline ──

	private renderPlanOutline(dayIndex: number, item: TimelineItem, showText = true): void {
		if (!this.gridEl) return;

		const dayStartMin = this.settings.dayStartHour * 60;
		const dayEndMin = this.settings.dayEndHour * 60;
		const startOffset = item.planTime.start - dayStartMin;
		const endOffset = item.planTime.end - dayStartMin;

		if (startOffset < 0 || endOffset > (dayEndMin - dayStartMin)) return;

		const dayColStart = (dayIndex - this.dayOffset) * 6 + 2;
		const color = this.getCategoryColor(item.tags);
		const segments = this.getHourSegments(startOffset, endOffset);
		const has5minStart = startOffset % 10 !== 0;
		const has5minEnd = endOffset % 10 !== 0;

		segments.forEach((seg, i) => {
			const outline = this.gridEl!.createDiv({
				cls: "weekflow-block weekflow-block-plan-outline",
			});
			outline.style.gridRow = `${seg.row}`;
			outline.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			outline.style.borderColor = color;
			outline.style.color = color;

			// Content and time in first segment (only when not overlapping with actual)
			if (i === 0 && showText) {
				const contentEl = outline.createDiv({ cls: "weekflow-block-content" });
				contentEl.setText(item.content);

				const timeEl = outline.createDiv({ cls: "weekflow-block-time" });
				timeEl.setText(
					`${formatTime(item.planTime.start)}-${formatTime(item.planTime.end)}`
				);
			}

			// 5-minute diagonal edges
			const slots = seg.slotEnd - seg.slotStart;
			if (i === 0 && has5minStart) {
				outline.addClass("weekflow-5min-start");
				outline.style.setProperty("--slots", String(slots));
			}
			if (i === segments.length - 1 && has5minEnd) {
				outline.addClass("weekflow-5min-end");
				outline.style.setProperty("--slots", String(slots));
			}
		});
	}

	// ── Overlap Groups & Handles ──

	private computeOverlapGroups(): void {
		this.overlapGroupMap.clear();
		let groupIndex = 0;
		const getTime = (item: TimelineItem) =>
			item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;

		for (let i = 0; i < this.visibleDays; i++) {
			const d = this.dayOffset + i;
			const dateKey = this.dates[d].format("YYYY-MM-DD");
			const items = this.weekData.get(dateKey) || [];

			const adj = new Map<string, Set<string>>();
			for (const item of items) adj.set(item.id, new Set());

			for (let i = 0; i < items.length; i++) {
				for (let j = i + 1; j < items.length; j++) {
					const aTime = getTime(items[i]);
					const bTime = getTime(items[j]);
					if (aTime.start < bTime.end && bTime.start < aTime.end) {
						adj.get(items[i].id)!.add(items[j].id);
						adj.get(items[j].id)!.add(items[i].id);
					}
				}
			}

			const visited = new Set<string>();
			for (const item of items) {
				if (visited.has(item.id)) continue;
				const neighbors = adj.get(item.id);
				if (!neighbors || neighbors.size === 0) continue;

				const group: string[] = [];
				const stack = [item.id];
				while (stack.length) {
					const curr = stack.pop()!;
					if (visited.has(curr)) continue;
					visited.add(curr);
					group.push(curr);
					for (const nid of adj.get(curr)!) {
						if (!visited.has(nid)) stack.push(nid);
					}
				}

				if (group.length >= 2) {
					for (const id of group) {
						this.overlapGroupMap.set(id, groupIndex);
					}
					groupIndex++;
				}
			}
		}
	}

	private renderOverlapHandlesForDay(dayIndex: number, items: TimelineItem[]): void {
		if (!this.gridEl) return;

		const groups = new Map<number, TimelineItem[]>();
		for (const item of items) {
			const gIdx = this.overlapGroupMap.get(item.id);
			if (gIdx === undefined) continue;
			if (!groups.has(gIdx)) groups.set(gIdx, []);
			groups.get(gIdx)!.push(item);
		}

		for (const [, group] of groups) {
			if (group.length < 2) continue;
			this.renderHandleBar(dayIndex, group);
		}
	}

	private renderHandleBar(dayIndex: number, group: TimelineItem[]): void {
		if (!this.gridEl) return;

		const getTime = (item: TimelineItem) =>
			item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;

		const dayStartMin = this.settings.dayStartHour * 60;
		let minStart = Infinity;
		for (const item of group) {
			minStart = Math.min(minStart, getTime(item).start);
		}

		const startOffset = minStart - dayStartMin;
		const startHour = Math.floor(startOffset / 60);
		const row = startHour + 2;
		const dayColStart = (dayIndex - this.dayOffset) * 6 + 2;

		const groupIdx = this.overlapGroupMap.get(group[0].id)!;

		const handleBar = this.gridEl.createDiv({ cls: "weekflow-overlap-handles" });
		handleBar.style.gridRow = String(row);
		handleBar.style.gridColumn = `${dayColStart} / ${dayColStart + 6}`;
		handleBar.style.display = "none";

		this.handleBarElements.set(groupIdx, handleBar);

		handleBar.addEventListener("pointerenter", () => this.showGroupHandles(groupIdx));
		handleBar.addEventListener("pointerleave", () => this.scheduleHideGroupHandles(groupIdx));

		const sorted = [...group].sort((a, b) => getTime(a).start - getTime(b).start);

		for (const item of sorted) {
			const color = this.getCategoryColor(item.tags);
			const handle = handleBar.createDiv({ cls: "weekflow-overlap-handle" });
			handle.style.backgroundColor = color;
			handle.title = item.content;
			handle.dataset.itemId = item.id;

			if (this.selectedBlockId === item.id) {
				handle.addClass("weekflow-overlap-handle-active");
			}

			handle.addEventListener("pointerdown", (e) => {
				e.stopPropagation();
				e.preventDefault();
			});

			handle.addEventListener("click", (e) => {
				e.stopPropagation();
				this.selectOverlapBlock(item.id);
			});
		}
	}

	private showGroupHandles(groupIdx: number): void {
		const timer = this.groupHoverTimers.get(groupIdx);
		if (timer) {
			clearTimeout(timer);
			this.groupHoverTimers.delete(groupIdx);
		}
		const bar = this.handleBarElements.get(groupIdx);
		if (bar) bar.style.display = "flex";
	}

	private scheduleHideGroupHandles(groupIdx: number): void {
		const timer = setTimeout(() => {
			this.groupHoverTimers.delete(groupIdx);
			const bar = this.handleBarElements.get(groupIdx);
			if (bar) bar.style.display = "none";
		}, 150);
		this.groupHoverTimers.set(groupIdx, timer);
	}

	private selectOverlapBlock(id: string): void {
		this.selectedBlockId = (this.selectedBlockId === id) ? null : id;
		this.updateOverlapStyles();
	}

	private deselectOverlapBlock(): void {
		if (this.selectedBlockId === null) return;
		this.selectedBlockId = null;
		this.updateOverlapStyles();
	}

	private updateOverlapStyles(): void {
		if (!this.gridEl) return;

		const selectedGroup = this.selectedBlockId !== null
			? this.overlapGroupMap.get(this.selectedBlockId) : undefined;

		this.gridEl.querySelectorAll(".weekflow-block-overlap").forEach((el) => {
			const htmlEl = el as HTMLElement;
			const itemId = htmlEl.dataset.itemId;
			const group = itemId ? this.overlapGroupMap.get(itemId) : undefined;

			htmlEl.removeClass("weekflow-block-selected");
			htmlEl.removeClass("weekflow-block-dimmed");

			if (this.selectedBlockId !== null && group === selectedGroup) {
				if (itemId === this.selectedBlockId) {
					htmlEl.addClass("weekflow-block-selected");
				} else {
					htmlEl.addClass("weekflow-block-dimmed");
				}
			}
		});

		this.gridEl.querySelectorAll(".weekflow-overlap-handle").forEach((el) => {
			const htmlEl = el as HTMLElement;
			htmlEl.removeClass("weekflow-overlap-handle-active");
			if (this.selectedBlockId && htmlEl.dataset.itemId === this.selectedBlockId) {
				htmlEl.addClass("weekflow-overlap-handle-active");
			}
		});
	}

	// ── Calendar Overlay ──

	private renderCalendarOverlay(): void {
		if (!this.gridEl || this.calendarEvents.length === 0) return;

		const dayStartMin = this.settings.dayStartHour * 60;
		const dayEndMin = this.settings.dayEndHour * 60;

		for (let i = 0; i < this.visibleDays; i++) {
			const d = this.dayOffset + i;
			const dayDate = this.dates[d];
			const dayStart = new Date(dayDate.year(), dayDate.month(), dayDate.date(), 0, 0, 0);
			const dayEnd = new Date(dayDate.year(), dayDate.month(), dayDate.date(), 23, 59, 59);

			const dayEvents = this.calendarEvents.filter((ev) => {
				return ev.start.getTime() < dayEnd.getTime() && ev.end.getTime() > dayStart.getTime();
			});

			for (const ev of dayEvents) {
				// Clip event to this day
				const evStartInDay = ev.start.getTime() < dayStart.getTime() ? dayStart : ev.start;
				const evEndInDay = ev.end.getTime() > dayEnd.getTime() ? dayEnd : ev.end;

				const startMinutes = evStartInDay.getHours() * 60 + evStartInDay.getMinutes();
				const endMinutes = evEndInDay.getHours() * 60 + evEndInDay.getMinutes();

				// Clamp to visible range
				const clampedStart = Math.max(dayStartMin, Math.round(startMinutes / 10) * 10);
				const clampedEnd = Math.min(dayEndMin, Math.round(endMinutes / 10) * 10);
				if (clampedEnd <= clampedStart) continue;

				const startOffset = clampedStart - dayStartMin;
				const endOffset = clampedEnd - dayStartMin;
				const dayColStart = i * 6 + 2;
				const segments = this.getHourSegments(startOffset, endOffset);
				if (segments.length === 0) continue;

				// Find widest segment for label
				const widestIdx = segments.reduce((best, seg, idx) => {
					const w = seg.slotEnd - seg.slotStart;
					const bw = segments[best].slotEnd - segments[best].slotStart;
					return w > bw ? idx : best;
				}, 0);

				const formatTimeStr = (d: Date) => {
					const h = d.getHours().toString().padStart(2, "0");
					const m = d.getMinutes().toString().padStart(2, "0");
					return `${h}:${m}`;
				};
				const tooltipText = `${ev.summary}\n${formatTimeStr(ev.start)}-${formatTimeStr(ev.end)}`;

				segments.forEach((seg, i) => {
					const block = this.gridEl!.createDiv({ cls: "weekflow-calendar-event" });
					block.style.gridRow = `${seg.row}`;
					block.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
					block.style.borderColor = ev.color;
					block.style.color = ev.color;
					block.title = tooltipText;

					if (i === widestIdx) {
						const content = block.createDiv({ cls: "weekflow-calendar-event-content" });
						content.setText(ev.summary);
					}
				});
			}
		}
	}

	// ── Current Time Indicator ──

	private renderCurrentTimeIndicator(): void {
		// Remove existing elements
		if (this.currentTimeEl) {
			this.currentTimeEl.remove();
			this.currentTimeEl = null;
		}
		if (this.currentTimeDotEl) {
			this.currentTimeDotEl.remove();
			this.currentTimeDotEl = null;
		}

		if (!this.gridEl) return;

		// Find today in visible range
		const today = window.moment();
		let todayVisibleIndex = -1;
		for (let i = 0; i < this.visibleDays; i++) {
			const d = this.dayOffset + i;
			if (this.dates[d].isSame(today, "day")) {
				todayVisibleIndex = i;
				break;
			}
		}
		if (todayVisibleIndex === -1) return;

		// Check if current time is within day range
		const currentMinutes = today.hour() * 60 + today.minute();
		const dayStartMin = this.settings.dayStartHour * 60;
		const dayEndMin = this.settings.dayEndHour * 60;
		if (currentMinutes < dayStartMin || currentMinutes >= dayEndMin) return;

		// Calculate geometry (same approach as getCellFromPoint)
		const gridRect = this.gridEl.getBoundingClientRect();
		if (gridRect.width === 0 || gridRect.height === 0) return;

		const timeLabelWidth = 60;
		const slotsWidth = gridRect.width - timeLabelWidth;
		const dayWidth = slotsWidth / this.visibleDays;

		const headerCell = this.gridEl.querySelector(".weekflow-header-cell");
		if (!headerCell) return;
		const headerHeight = (headerCell as HTMLElement).getBoundingClientRect().height;

		const totalMinutes = dayEndMin - dayStartMin;
		const bodyHeight = gridRect.height - headerHeight;
		if (bodyHeight <= 0) return;

		const minutesSinceDayStart = currentMinutes - dayStartMin;
		const topPos = headerHeight + (minutesSinceDayStart / totalMinutes) * bodyHeight;
		const leftPos = timeLabelWidth + todayVisibleIndex * dayWidth;

		// Create line
		const line = this.gridEl.createDiv({ cls: "weekflow-now-line" });
		line.style.top = `${topPos - 1}px`;
		line.style.left = `${leftPos}px`;
		line.style.width = `${dayWidth}px`;
		this.currentTimeEl = line;

		// Create dot (centered at left edge of line, protruding into time label column)
		const dot = this.gridEl.createDiv({ cls: "weekflow-now-dot" });
		dot.style.top = `${topPos - 4}px`;
		dot.style.left = `${leftPos - 4}px`;
		this.currentTimeDotEl = dot;
	}

	// ── Touch Block Selection ──

	private handleTouchBlockTap(dayIndex: number, item: TimelineItem, blockEl: HTMLElement): void {
		// Clear any pending cell tap-tap anchor
		this.clearSelection();

		if (this.touchBlockSelection?.item.id === item.id) {
			// Same block: if pen hover, convert to permanent selection
			if (this.touchBlockSelection.isPenHover) {
				this.touchBlockSelection.isPenHover = false;
				this.touchBlockSelection.penTapConverted = true;
			}
			return;
		}
		// Different block or no selection — (re)select
		this.clearTouchBlockSelection();
		const dragTime = item.checkbox === "actual" && item.actualTime ? item.actualTime : item.planTime;
		this.touchBlockSelection = {
			mode: "selected",
			dayIndex,
			item,
			originalStart: dragTime.start,
			originalEnd: dragTime.end,
			originalDayIndex: dayIndex,
			isPenHover: false,
			penTapConverted: false,
		};
		this.updateTouchBlockSelectionStyles();
		this.showActionBar(dayIndex, item, blockEl);
	}

	private showActionBar(dayIndex: number, item: TimelineItem, anchorEl: HTMLElement): void {
		this.removeActionBar();

		const bar = document.createElement("div");
		bar.className = "weekflow-action-bar";

		const makeBtn = (icon: string, label: string, cls: string, onClick: () => void): HTMLElement => {
			const btn = document.createElement("button");
			btn.className = `weekflow-action-bar-btn ${cls}`;
			btn.ariaLabel = label;
			setIcon(btn, icon);
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				// Any action bar button click converts pen hover to permanent
				if (this.touchBlockSelection?.isPenHover) {
					this.touchBlockSelection.isPenHover = false;
					this.touchBlockSelection.penTapConverted = true;
				}
				onClick();
			});
			btn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
			return btn;
		};

		// Edit
		bar.appendChild(makeBtn("pencil", "Edit", "", () => {
			this.clearTouchBlockSelection();
			this.callbacks.onBlockClick(dayIndex, item);
		}));

		// Move
		bar.appendChild(makeBtn("move", "Move", "", () => {
			this.enterMoveMode();
		}));

		// Delete
		bar.appendChild(makeBtn("trash-2", "Delete", "", () => {
			this.enterDeleteConfirmMode();
		}));

		// Navigate to note
		if (this.callbacks.onBlockNavigate) {
			const navCb = this.callbacks.onBlockNavigate;
			bar.appendChild(makeBtn("arrow-up-right", "Go to daily note", "", () => {
				this.clearTouchBlockSelection();
				navCb(dayIndex, item);
			}));
		}

		// More (context menu)
		if (this.callbacks.onBlockRightClick) {
			const menuCb = this.callbacks.onBlockRightClick;
			bar.appendChild(makeBtn("more-horizontal", "More", "", () => {
				// Create a synthetic pointer event at the action bar position
				const rect = bar.getBoundingClientRect();
				const syntheticEvent = new PointerEvent("pointerdown", {
					clientX: rect.left,
					clientY: rect.top,
					bubbles: true,
				});
				this.clearTouchBlockSelection();
				menuCb(dayIndex, item, syntheticEvent);
			}));
		}

		this.mountActionBar(bar, anchorEl);
	}

	private showMoveActionBar(anchorEl: HTMLElement): void {
		this.removeActionBar();

		const bar = document.createElement("div");
		bar.className = "weekflow-action-bar weekflow-action-bar-move";

		const confirmBtn = document.createElement("button");
		confirmBtn.className = "weekflow-action-bar-btn weekflow-action-bar-confirm";
		confirmBtn.ariaLabel = "Confirm move";
		setIcon(confirmBtn, "check");
		confirmBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
		confirmBtn.addEventListener("click", (e) => { e.stopPropagation(); this.confirmMove(); });
		bar.appendChild(confirmBtn);

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "weekflow-action-bar-btn weekflow-action-bar-cancel";
		cancelBtn.ariaLabel = "Cancel move";
		setIcon(cancelBtn, "x");
		cancelBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
		cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); this.cancelMove(); });
		bar.appendChild(cancelBtn);

		this.mountActionBar(bar, anchorEl);
	}

	private showDeleteConfirmActionBar(anchorEl: HTMLElement): void {
		this.removeActionBar();

		const bar = document.createElement("div");
		bar.className = "weekflow-action-bar weekflow-action-bar-delete";

		const confirmBtn = document.createElement("button");
		confirmBtn.className = "weekflow-action-bar-btn weekflow-action-bar-delete-confirm";
		confirmBtn.ariaLabel = "Confirm delete";
		setIcon(confirmBtn, "trash-2");
		confirmBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
		confirmBtn.addEventListener("click", (e) => { e.stopPropagation(); this.confirmDelete(); });
		bar.appendChild(confirmBtn);

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "weekflow-action-bar-btn weekflow-action-bar-cancel";
		cancelBtn.ariaLabel = "Cancel delete";
		setIcon(cancelBtn, "x");
		cancelBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
		cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); this.cancelDeleteConfirm(); });
		bar.appendChild(cancelBtn);

		this.mountActionBar(bar, anchorEl);
	}

	private mountActionBar(bar: HTMLElement, anchorEl: HTMLElement): void {
		document.body.appendChild(bar);
		this.actionBarEl = bar;
		this.actionBarHovered = false;

		// Track pen hover on the action bar to prevent premature pen-hover dismiss
		bar.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "pen") {
				this.actionBarHovered = true;
			}
		});
		bar.addEventListener("pointerleave", (e) => {
			if (e.pointerType === "pen") {
				this.actionBarHovered = false;
				// If pen left action bar and selection is still hover-based, schedule dismiss
				if (this.touchBlockSelection?.isPenHover && !this.touchBlockSelection?.penTapConverted) {
					setTimeout(() => {
						if (this.touchBlockSelection?.isPenHover
							&& !this.touchBlockSelection?.penTapConverted
							&& !this.actionBarHovered) {
							this.clearTouchBlockSelection();
						}
					}, 150);
				}
			}
		});

		this.positionActionBar(anchorEl);
	}

	private positionActionBar(anchorEl: HTMLElement): void {
		if (!this.actionBarEl) return;

		// Find the last (bottom-most) segment of this block
		const itemId = anchorEl.dataset.itemId;
		let lastRect = anchorEl.getBoundingClientRect();
		if (itemId && this.gridEl) {
			const segments = this.gridEl.querySelectorAll(`.weekflow-block[data-item-id="${itemId}"]`);
			segments.forEach((seg) => {
				const r = seg.getBoundingClientRect();
				if (r.bottom > lastRect.bottom) {
					lastRect = r;
				}
			});
		}

		const barHeight = this.actionBarEl.offsetHeight || 44;
		const gap = 4;

		// Always below the last segment, clamped to viewport
		let top = lastRect.bottom + gap;
		top = Math.min(top, window.innerHeight - barHeight - 4);
		top = Math.max(4, top);

		let left = lastRect.left + lastRect.width / 2;
		this.actionBarEl.style.left = `${left}px`;
		this.actionBarEl.style.top = `${top}px`;

		// After render: clamp horizontally
		requestAnimationFrame(() => {
			if (!this.actionBarEl) return;
			const barRect = this.actionBarEl.getBoundingClientRect();
			if (barRect.left < 4) {
				this.actionBarEl.style.left = `${4 + barRect.width / 2}px`;
			} else if (barRect.right > window.innerWidth - 4) {
				this.actionBarEl.style.left = `${window.innerWidth - 4 - barRect.width / 2}px`;
			}
		});
	}

	private removeActionBar(): void {
		if (this.actionBarEl) {
			this.actionBarEl.remove();
			this.actionBarEl = null;
		}
		this.actionBarHovered = false;
	}

	private enterMoveMode(): void {
		if (!this.touchBlockSelection) return;
		// Convert pen hover to permanent selection (explicit user action)
		this.touchBlockSelection.isPenHover = false;
		this.touchBlockSelection.penTapConverted = true;
		this.touchBlockSelection.mode = "move";
		this.updateTouchBlockSelectionStyles();
		hapticFeedback();

		const blockEl = this.findBlockElement(this.touchBlockSelection.item.id);
		if (blockEl) {
			this.showMoveActionBar(blockEl);
		}
	}

	private confirmMove(): void {
		if (!this.touchBlockSelection) return;

		if (this.blockDragState) {
			const { lastDay, lastStart } = this.blockDragState;
			if (lastDay >= 0 && lastStart >= 0) {
				this.callbacks.onBlockDragEnd(
					this.blockDragState.item,
					this.blockDragState.fromDay,
					lastDay,
					lastStart
				);
			}
			this.blockDragState = null;
		}

		if (this.resizeState) {
			const { currentStart, currentEnd, originalStart, originalEnd } = this.resizeState;
			if (currentStart !== originalStart || currentEnd !== originalEnd) {
				this.callbacks.onBlockResize(
					this.resizeState.item,
					this.resizeState.dayIndex,
					currentStart,
					currentEnd
				);
			}
			this.resizeState = null;
		}

		this.removeGhost();
		this.removeResizeGhost();
		this.clearTouchBlockSelection();
	}

	private cancelMove(): void {
		this.dragMode = "none";
		this.blockDragState = null;
		this.resizeState = null;
		this.removeGhost();
		this.removeResizeGhost();

		if (!this.touchBlockSelection) return;
		this.touchBlockSelection.mode = "selected";
		this.updateTouchBlockSelectionStyles();

		const blockEl = this.findBlockElement(this.touchBlockSelection.item.id);
		if (blockEl) {
			this.showActionBar(this.touchBlockSelection.dayIndex, this.touchBlockSelection.item, blockEl);
		}
	}

	private enterDeleteConfirmMode(): void {
		if (!this.touchBlockSelection) return;
		// Convert pen hover to permanent selection (explicit user action)
		this.touchBlockSelection.isPenHover = false;
		this.touchBlockSelection.penTapConverted = true;
		this.touchBlockSelection.mode = "delete-confirm";
		this.updateTouchBlockSelectionStyles();

		const blockEl = this.findBlockElement(this.touchBlockSelection.item.id);
		if (blockEl) {
			this.showDeleteConfirmActionBar(blockEl);
		}
	}

	private confirmDelete(): void {
		if (!this.touchBlockSelection) return;
		const { dayIndex, item } = this.touchBlockSelection;
		this.clearTouchBlockSelection();
		if (this.callbacks.onBlockDelete) {
			this.callbacks.onBlockDelete(dayIndex, item);
		}
	}

	private cancelDeleteConfirm(): void {
		if (!this.touchBlockSelection) return;
		this.touchBlockSelection.mode = "selected";
		this.updateTouchBlockSelectionStyles();

		const blockEl = this.findBlockElement(this.touchBlockSelection.item.id);
		if (blockEl) {
			this.showActionBar(this.touchBlockSelection.dayIndex, this.touchBlockSelection.item, blockEl);
		}
	}

	public clearTouchSelection(): void {
		this.clearTouchBlockSelection();
	}

	private clearTouchBlockSelection(): void {
		if (this.touchBlockSelection?.mode === "move") {
			this.dragMode = "none";
			this.blockDragState = null;
			this.resizeState = null;
			this.removeGhost();
			this.removeResizeGhost();
		}
		this.touchBlockSelection = null;
		this.removeActionBar();
		this.hideTooltip();

		// Remove selection CSS classes and restore touch-action from all blocks
		if (this.gridEl) {
			this.gridEl.querySelectorAll(".weekflow-block-touch-selected").forEach(
				(el) => {
					el.removeClass("weekflow-block-touch-selected");
					(el as HTMLElement).style.touchAction = "";
				}
			);
			this.gridEl.querySelectorAll(".weekflow-block-move-mode").forEach(
				(el) => el.removeClass("weekflow-block-move-mode")
			);
			this.gridEl.querySelectorAll(".weekflow-block-delete-pending").forEach(
				(el) => el.removeClass("weekflow-block-delete-pending")
			);
		}
	}

	private updateTouchBlockSelectionStyles(): void {
		if (!this.gridEl) return;

		// Remove all touch selection classes and restore touch-action
		this.gridEl.querySelectorAll(".weekflow-block-touch-selected").forEach(
			(el) => {
				el.removeClass("weekflow-block-touch-selected");
				(el as HTMLElement).style.touchAction = "";
			}
		);
		this.gridEl.querySelectorAll(".weekflow-block-move-mode").forEach(
			(el) => el.removeClass("weekflow-block-move-mode")
		);
		this.gridEl.querySelectorAll(".weekflow-block-delete-pending").forEach(
			(el) => el.removeClass("weekflow-block-delete-pending")
		);

		if (!this.touchBlockSelection) return;

		const itemId = this.touchBlockSelection.item.id;
		const blocks = this.gridEl.querySelectorAll(`.weekflow-block[data-item-id="${itemId}"]`);
		blocks.forEach((el) => {
			el.addClass("weekflow-block-touch-selected");
			if (this.touchBlockSelection!.mode === "move") {
				el.addClass("weekflow-block-move-mode");
				// Allow touch drag by disabling browser scroll on this block
				(el as HTMLElement).style.touchAction = "none";
			} else if (this.touchBlockSelection!.mode === "delete-confirm") {
				el.addClass("weekflow-block-delete-pending");
			}
		});
	}

	private findBlockElement(itemId: string): HTMLElement | null {
		if (!this.gridEl) return null;
		return this.gridEl.querySelector(`.weekflow-block[data-item-id="${itemId}"]`) as HTMLElement | null;
	}

	private getCategoryColor(tags: string[]): string {
		for (const tag of tags) {
			const cat = this.settings.categories.find((c) => c.tag === tag);
			if (cat) return cat.color;
		}
		return "#888888";
	}
}
