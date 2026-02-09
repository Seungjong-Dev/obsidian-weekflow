import { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { Category, TimelineItem, WeekFlowSettings } from "./types";
import { formatTime } from "./parser";

export interface GridCallbacks {
	onCellDragStart: (dayIndex: number, minutes: number) => void;
	onCellDragMove: (dayIndex: number, minutes: number) => void;
	onCellDragEnd: () => void;
	onBlockClick: (dayIndex: number, item: TimelineItem) => void;
}

interface SelectionRange {
	dayIndex: number;
	startMinutes: number;
	endMinutes: number;
}

export class GridRenderer {
	private containerEl: HTMLElement;
	private settings: WeekFlowSettings;
	private dates: Moment[];
	private weekData: Map<string, TimelineItem[]>;
	private mode: "plan" | "actual";
	private callbacks: GridCallbacks;
	private gridEl: HTMLElement | null = null;
	private selectionRange: SelectionRange | null = null;
	private isDragging = false;
	private dragAnchorMinutes = 0; // mousedown cell

	constructor(
		containerEl: HTMLElement,
		settings: WeekFlowSettings,
		dates: Moment[],
		weekData: Map<string, TimelineItem[]>,
		mode: "plan" | "actual",
		callbacks: GridCallbacks
	) {
		this.containerEl = containerEl;
		this.settings = settings;
		this.dates = dates;
		this.weekData = weekData;
		this.mode = mode;
		this.callbacks = callbacks;
	}

	/**
	 * Grid layout:
	 *   Columns: 1 time-label + 7 days × 6 ten-minute slots = 43 columns
	 *   Rows:    1 header + totalHours
	 *
	 *   Day d occupies columns: (d*6 + 2) .. (d*6 + 7)   (1-based)
	 *   Hour h occupies row: (h - dayStartHour) + 2       (1-based, +1 for header)
	 */
	render(): void {
		this.containerEl.empty();

		this.gridEl = this.containerEl.createDiv({ cls: "weekflow-grid" });
		const totalHours = this.settings.dayEndHour - this.settings.dayStartHour;

		// Columns: 60px time label + 7 groups of 6 equal-width slots
		this.gridEl.style.gridTemplateColumns =
			`60px repeat(${7 * 6}, 1fr)`;
		// Rows: auto header + one row per hour
		this.gridEl.style.gridTemplateRows =
			`auto repeat(${totalHours}, minmax(40px, 1fr))`;

		// ── Header row ──
		// Corner cell spans column 1
		const corner = this.gridEl.createDiv({
			cls: "weekflow-header-cell weekflow-corner",
		});
		corner.style.gridColumn = "1";
		corner.style.gridRow = "1";

		// Day headers — each spans 6 columns
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
			const row = (h - this.settings.dayStartHour) + 2; // +1 header, +1 for 1-based

			// Time label
			const timeLabel = this.gridEl.createDiv({
				cls: "weekflow-time-label",
				text: formatTime(h * 60),
			});
			timeLabel.style.gridColumn = "1";
			timeLabel.style.gridRow = `${row}`;

			// 6 ten-minute cells per day
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

					// Mouse events for drag selection
					cell.addEventListener("mousedown", (e) => {
						e.preventDefault();
						this.isDragging = true;
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
						if (!this.isDragging || !this.selectionRange) return;
						if (this.selectionRange.dayIndex !== d) return;

						// Range = anchor cell to current cell
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

		// Global mouseup
		const mouseUpHandler = () => {
			if (this.isDragging) {
				this.isDragging = false;
				this.callbacks.onCellDragEnd();
			}
		};
		document.addEventListener("mouseup", mouseUpHandler);

		// Render blocks on top
		this.renderBlocks();
	}

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
		this.isDragging = false;
		if (this.gridEl) {
			this.gridEl
				.querySelectorAll(".weekflow-cell-selected")
				.forEach((el) => el.removeClass("weekflow-cell-selected"));
		}
	}

	getSelection(): SelectionRange | null {
		return this.selectionRange;
	}

	/**
	 * Convert a TimelineItem time range to grid column/row coordinates.
	 *
	 * Column: dayColStart + slotOffset  (within a day's 6-column group)
	 * Row:    hour row
	 *
	 * A block that spans multiple hours spans multiple rows.
	 * A block that starts/ends at non-hour boundaries spans partial columns within its start/end rows.
	 * For simplicity in Phase 1, blocks span full column groups for their day.
	 */
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

	/**
	 * Compute per-hour-row segments for a time range.
	 * Each segment = { row, colStart, colEnd } with column offsets relative to day group.
	 *
	 * Example: 13:30-14:30 (dayStartHour=6, startOffset=450, endOffset=510)
	 *   → hour 7 (13:00 row): slots 3..6   (13:30-14:00)
	 *   → hour 8 (14:00 row): slots 0..3   (14:00-14:30)
	 */
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
				row: h + 2, // +1 header, +1 for 1-based grid
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

		segments.forEach((seg, i) => {
			const block = this.gridEl!.createDiv({ cls: "weekflow-block" });
			block.style.gridRow = `${seg.row}`;
			block.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;

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

			// Connected segments: right edge → next row left edge
			if (segments.length > 1) {
				if (i < segments.length - 1) block.addClass("weekflow-block-cont-right");
				if (i > 0) block.addClass("weekflow-block-cont-left");
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

			block.addEventListener("click", (e) => {
				e.stopPropagation();
				this.callbacks.onBlockClick(dayIndex, item);
			});
		});

		// Plan outline when plan ≠ actual
		if (item.checkbox === "actual" && item.actualTime) {
			this.renderPlanOutline(dayIndex, item);
		}
	}

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

		for (const seg of segments) {
			const outline = this.gridEl.createDiv({
				cls: "weekflow-block weekflow-block-plan-outline",
			});
			outline.style.gridRow = `${seg.row}`;
			outline.style.gridColumn = `${dayColStart + seg.slotStart} / ${dayColStart + seg.slotEnd}`;
			outline.style.borderColor = color;
		}
	}

	private getCategoryColor(tags: string[]): string {
		for (const tag of tags) {
			const cat = this.settings.categories.find((c) => c.tag === tag);
			if (cat) return cat.color;
		}
		return "#888888";
	}
}
