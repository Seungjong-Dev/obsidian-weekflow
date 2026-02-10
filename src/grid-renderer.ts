import { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { Category, TimelineItem, WeekFlowSettings } from "./types";
import { formatTime } from "./parser";

export interface GridCallbacks {
	onCellDragStart: (dayIndex: number, minutes: number) => void;
	onCellDragMove: (dayIndex: number, minutes: number) => void;
	onCellDragEnd: () => void;
	onBlockClick: (dayIndex: number, item: TimelineItem) => void;
	onBlockDragEnd: (item: TimelineItem, fromDay: number, toDay: number, newStart: number) => void;
	onBlockResize: (item: TimelineItem, dayIndex: number, newStart: number, newEnd: number) => void;
	onBlockDropOutside?: (item: TimelineItem, fromDay: number) => void;
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
const DRAG_DISTANCE_PX = 5;

export class GridRenderer {
	private containerEl: HTMLElement;
	private settings: WeekFlowSettings;
	private dates: Moment[];
	private weekData: Map<string, TimelineItem[]>;
	private mode: "plan" | "actual";
	private callbacks: GridCallbacks;
	private overlapIds: Set<string>;
	private gridEl: HTMLElement | null = null;
	private selectionRange: SelectionRange | null = null;

	// Drag state machine
	private dragMode: DragMode = "none";
	private dragAnchorMinutes = 0;

	// Block drag state
	private blockDragState: BlockDragState | null = null;
	private blockDragTimer: ReturnType<typeof setTimeout> | null = null;
	private blockDragStartX = 0;
	private blockDragStartY = 0;
	private ghostEls: HTMLElement[] = [];

	// Resize state
	private resizeState: ResizeState | null = null;
	private resizeGhostEls: HTMLElement[] = [];

	// Bound handlers for cleanup
	private boundMouseMove: ((e: MouseEvent) => void) | null = null;
	private boundMouseUp: ((e: MouseEvent) => void) | null = null;

	constructor(
		containerEl: HTMLElement,
		settings: WeekFlowSettings,
		dates: Moment[],
		weekData: Map<string, TimelineItem[]>,
		mode: "plan" | "actual",
		callbacks: GridCallbacks,
		overlapIds: Set<string> = new Set()
	) {
		this.containerEl = containerEl;
		this.settings = settings;
		this.dates = dates;
		this.weekData = weekData;
		this.mode = mode;
		this.callbacks = callbacks;
		this.overlapIds = overlapIds;
	}

	render(): void {
		this.containerEl.empty();

		this.gridEl = this.containerEl.createDiv({ cls: "weekflow-grid" });
		const totalHours = this.settings.dayEndHour - this.settings.dayStartHour;

		this.gridEl.style.gridTemplateColumns =
			`60px repeat(${7 * 6}, 1fr)`;
		this.gridEl.style.gridTemplateRows =
			`auto repeat(${totalHours}, minmax(40px, 1fr))`;

		// ── Header row ──
		const corner = this.gridEl.createDiv({
			cls: "weekflow-header-cell weekflow-corner",
		});
		corner.style.gridColumn = "1";
		corner.style.gridRow = "1";

		for (let d = 0; d < 7; d++) {
			const colStart = d * 6 + 2;
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

			for (let d = 0; d < 7; d++) {
				const dayColStart = d * 6 + 2;

				for (let slot = 0; slot < 6; slot++) {
					const minutes = h * 60 + slot * 10;
					const col = dayColStart + slot;

					const cell = this.gridEl.createDiv({ cls: "weekflow-cell" });
					cell.style.gridColumn = `${col}`;
					cell.style.gridRow = `${row}`;

					if (slot === 0) cell.addClass("weekflow-cell-day-start");

					cell.dataset.day = String(d);
					cell.dataset.minutes = String(minutes);

					// Cell mousedown → start cell selection (only if no block drag in progress)
					cell.addEventListener("mousedown", (e) => {
						if (this.dragMode !== "none") return;
						e.preventDefault();

						this.dragMode = "cell-select";
						this.dragAnchorMinutes = minutes;
						this.selectionRange = {
							dayIndex: d,
							startMinutes: minutes,
							endMinutes: minutes + 10,
						};
						this.updateSelectionHighlight();
						this.callbacks.onCellDragStart(d, minutes);
					});

					cell.addEventListener("mouseenter", () => {
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

		// Global mouse handlers
		this.boundMouseMove = (e: MouseEvent) => this.onGlobalMouseMove(e);
		this.boundMouseUp = (e: MouseEvent) => this.onGlobalMouseUp(e);
		document.addEventListener("mousemove", this.boundMouseMove);
		document.addEventListener("mouseup", this.boundMouseUp);

		this.renderBlocks();
	}

	destroy(): void {
		if (this.boundMouseMove) {
			document.removeEventListener("mousemove", this.boundMouseMove);
		}
		if (this.boundMouseUp) {
			document.removeEventListener("mouseup", this.boundMouseUp);
		}
	}

	// ── Global Mouse Handlers ──

	private onGlobalMouseMove(e: MouseEvent) {
		if (this.dragMode === "block-drag" && this.blockDragState) {
			this.onBlockDragMove(e);
		} else if (this.dragMode === "resize" && this.resizeState) {
			this.onResizeDragMove(e);
		}
	}

	private onGlobalMouseUp(e: MouseEvent) {
		if (this.dragMode === "cell-select") {
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
		const dayColStart = dayIndex * 6 + 2;
		const segments = this.getHourSegments(startOffset, endOffset);

		segments.forEach((seg, i) => {
			const ghost = this.gridEl!.createDiv({ cls: "weekflow-block-ghost" });
			ghost.style.gridRow = `${seg.row}`;
			ghost.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			ghost.style.backgroundColor = color + "40";
			ghost.style.borderColor = color;
			if (i === 0) ghost.setText(label);
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
		const x = clientX - gridRect.left + this.containerEl.scrollLeft;
		const y = clientY - gridRect.top + this.containerEl.scrollTop;

		// Column layout: 60px time label + 42 equal slots
		const timeLabelWidth = 60;
		if (x < timeLabelWidth) return null;

		const slotsWidth = gridRect.width - timeLabelWidth;
		if (slotsWidth <= 0) return null;

		const slotWidth = slotsWidth / (7 * 6);
		const slotIndex = Math.floor((x - timeLabelWidth) / slotWidth);
		if (slotIndex < 0 || slotIndex >= 42) return null;

		const dayIndex = Math.floor(slotIndex / 6);
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

		for (let d = 0; d < 7; d++) {
			const dateKey = this.dates[d].format("YYYY-MM-DD");
			const items = this.weekData.get(dateKey) || [];

			for (const item of items) {
				this.renderBlock(d, item);
			}
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

		const dayColStart = dayIndex * 6 + 2;
		const segments = this.getHourSegments(startOffset, endOffset);
		if (segments.length === 0) return;

		const color = this.getCategoryColor(item.tags);
		const isOverlap = this.overlapIds.has(item.id);
		const has5minStart = startOffset % 10 !== 0;
		const has5minEnd = endOffset % 10 !== 0;

		segments.forEach((seg, i) => {
			const block = this.gridEl!.createDiv({ cls: "weekflow-block" });
			block.style.gridRow = `${seg.row}`;
			block.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			block.style.position = "relative";

			// Overlap styling
			if (isOverlap) {
				block.addClass("weekflow-block-overlap");
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

			// Content text only in first segment
			if (i === 0) {
				const contentEl = block.createDiv({ cls: "weekflow-block-content" });
				contentEl.setText(item.content);

				const timeEl = block.createDiv({ cls: "weekflow-block-time" });
				timeEl.setText(
					`${formatTime(item.planTime.start)}-${formatTime(item.planTime.end)}`
				);
			}

			// ── Resize Handles ──
			// Left handle on first segment (drag start time)
			if (i === 0) {
				const leftHandle = block.createDiv({ cls: "weekflow-resize-handle weekflow-resize-left" });
				leftHandle.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.startResize(item, dayIndex, "left", e);
				});
			}

			// Right handle on last segment (drag end time)
			if (i === segments.length - 1) {
				const rightHandle = block.createDiv({ cls: "weekflow-resize-handle weekflow-resize-right" });
				rightHandle.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.startResize(item, dayIndex, "right", e);
				});
			}

			// ── Block mousedown: click vs drag detection ──
			block.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();

				this.blockDragStartX = e.clientX;
				this.blockDragStartY = e.clientY;

				const cell = this.getCellFromPoint(e.clientX, e.clientY);
				const offsetMinutes = cell ? (cell.minutes - item.planTime.start) : 0;

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
					this.updateGhostPosition(e);
				}, DRAG_DELAY_MS);
			});

			block.addEventListener("click", (e) => {
				e.stopPropagation();
				const dx = e.clientX - this.blockDragStartX;
				const dy = e.clientY - this.blockDragStartY;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (this.dragMode === "none" && dist < DRAG_DISTANCE_PX) {
					this.callbacks.onBlockClick(dayIndex, item);
				}
			});
		});

		// Plan outline when plan ≠ actual
		if (item.checkbox === "actual" && item.actualTime) {
			this.renderPlanOutline(dayIndex, item);
		}
	}

	// ── Block Drag ──

	private updateGhostPosition(e: MouseEvent) {
		if (!this.blockDragState || !this.gridEl) return;

		const cell = this.getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;

		const item = this.blockDragState.item;
		const duration = item.planTime.end - item.planTime.start;
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

		const dayColStart = cell.dayIndex * 6 + 2;
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

		segments.forEach((seg, i) => {
			const ghost = this.gridEl!.createDiv({ cls: "weekflow-block-ghost" });
			ghost.style.gridRow = `${seg.row}`;
			ghost.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			ghost.style.backgroundColor = color + "40";
			ghost.style.borderColor = color;
			if (i === 0) ghost.setText(label);
			this.ghostEls.push(ghost);
		});
	}

	private onBlockDragMove(e: MouseEvent) {
		// Check if we've moved enough to confirm drag
		const dx = e.clientX - this.blockDragStartX;
		const dy = e.clientY - this.blockDragStartY;
		if (Math.abs(dx) < DRAG_DISTANCE_PX && Math.abs(dy) < DRAG_DISTANCE_PX) return;

		this.updateGhostPosition(e);
	}

	private onBlockDragFinish(e: MouseEvent) {
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
		if (cell.dayIndex === fromDay && snappedStart === item.planTime.start) return;

		this.callbacks.onBlockDragEnd(item, fromDay, cell.dayIndex, snappedStart);
	}

	// ── Resize ──

	private startResize(item: TimelineItem, dayIndex: number, edge: "left" | "right", e: MouseEvent) {
		this.dragMode = "resize";
		this.resizeState = {
			item,
			dayIndex,
			edge,
			originalStart: item.planTime.start,
			originalEnd: item.planTime.end,
			currentStart: item.planTime.start,
			currentEnd: item.planTime.end,
		};
	}

	private onResizeDragMove(e: MouseEvent) {
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
		const dayColStart = this.resizeState.dayIndex * 6 + 2;
		const startOffset = newStart - dayStartMin;
		const endOffset = newEnd - dayStartMin;
		const segments = this.getHourSegments(startOffset, endOffset);

		this.removeResizeGhost();
		const label = `${formatTime(newStart)}-${formatTime(newEnd)}`;
		segments.forEach((seg, i) => {
			const ghost = this.gridEl!.createDiv({ cls: "weekflow-block-ghost" });
			ghost.style.gridRow = `${seg.row}`;
			ghost.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			ghost.style.backgroundColor = color + "30";
			ghost.style.borderColor = color;
			if (i === 0) ghost.setText(label);
			this.resizeGhostEls.push(ghost);
		});
	}

	private removeResizeGhost() {
		for (const el of this.resizeGhostEls) el.remove();
		this.resizeGhostEls = [];
	}

	private onResizeDragFinish(e: MouseEvent) {
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

	private renderPlanOutline(dayIndex: number, item: TimelineItem): void {
		if (!this.gridEl) return;

		const dayStartMin = this.settings.dayStartHour * 60;
		const dayEndMin = this.settings.dayEndHour * 60;
		const startOffset = item.planTime.start - dayStartMin;
		const endOffset = item.planTime.end - dayStartMin;

		if (startOffset < 0 || endOffset > (dayEndMin - dayStartMin)) return;

		const dayColStart = dayIndex * 6 + 2;
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

	private getCategoryColor(tags: string[]): string {
		for (const tag of tags) {
			const cat = this.settings.categories.find((c) => c.tag === tag);
			if (cat) return cat.color;
		}
		return "#888888";
	}
}
