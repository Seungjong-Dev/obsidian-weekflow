import { Scope } from "obsidian";
import type { TimelineItem, WeekFlowSettings } from "./types";
import type { Moment } from "obsidian";

// ── Types ──

export type VimMode = "normal" | "insert" | "visual";

export interface CursorPosition {
	dayIndex: number;  // 0-6
	minutes: number;   // 0-1430, snapped to 10-min
}

interface VisualSelection {
	anchor: CursorPosition;
	head: CursorPosition;
}

export interface VimContext {
	// Data access
	dates: Moment[];
	weekData: Map<string, TimelineItem[]>;
	settings: WeekFlowSettings;
	visibleDays: number;
	dayOffset: number;

	// Block operations
	deleteBlock: (dayIndex: number, item: TimelineItem) => Promise<void>;
	completeBlock: (dayIndex: number, item: TimelineItem) => Promise<void>;
	uncompleteBlock: (dayIndex: number, item: TimelineItem) => Promise<void>;
	resizeBlock: (item: TimelineItem, dayIndex: number, newStart: number, newEnd: number) => Promise<void>;
	moveBlock: (item: TimelineItem, fromDay: number, toDay: number, newStart: number, newDuration?: number) => Promise<void>;
	openBlockEdit: (dayIndex: number, item: TimelineItem) => void;
	openInlineEditor: (dayIndex: number, startMinutes: number, endMinutes: number) => void;
	deferBlock: (dayIndex: number, item: TimelineItem) => Promise<void>;
	changeTag: (dayIndex: number, item: TimelineItem) => void;
	undo: () => Promise<void>;
	redo: () => Promise<void>;

	// UI callbacks
	showHelpModal: () => void;
	unfoldIfNeeded: (minutes: number) => void;
	refoldIfCursorLeft: (minutes: number) => void;
	shiftView: (dayIndex: number) => void;
	navigateWeek: (delta: number, landDayIndex: number) => void;
	navigateToToday: () => void;
	renderCursor: (pos: CursorPosition) => void;
	clearCursor: () => void;
	renderVisualHighlight: (startMinutes: number, endMinutes: number, dayIndex: number) => void;
	clearVisualHighlight: () => void;
	scrollToMinutes: (minutes: number) => void;
	updateModeIndicator: (mode: VimMode, info: string) => void;
	focusGrid: () => void;
}

// ── VimKeyboardManager ──

export class VimKeyboardManager {
	private ctx: VimContext;
	private mode: VimMode = "normal";
	private cursor: CursorPosition = { dayIndex: 0, minutes: 0 };
	private visual: VisualSelection | null = null;
	private pendingKeys = "";
	private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
	private scopeHandlers: any[] = [];
	private suspended = false;

	private singleKeyMap = new Map<string, () => void>();
	private shiftKeyMap = new Map<string, () => void>();
	private ctrlKeyMap = new Map<string, () => void>();
	private multiKeyMap = new Map<string, () => void>();
	private multiKeyPrefixes = new Set<string>();

	private visualSingleKeyMap = new Map<string, () => void>();
	private visualMultiKeyMap = new Map<string, () => void>();

	constructor(ctx: VimContext) {
		this.ctx = ctx;
		// Initialize cursor at today + current time
		const today = window.moment().format("YYYY-MM-DD");
		const todayIdx = ctx.dates.findIndex(d => d.format("YYYY-MM-DD") === today);
		const now = new Date();
		const minutes = Math.round((now.getHours() * 60 + now.getMinutes()) / 10) * 10;
		this.cursor = {
			dayIndex: todayIdx >= 0 ? todayIdx : ctx.dayOffset,
			minutes: Math.min(minutes, 1430),
		};
		this.buildKeyMaps();
	}

	updateContext(ctx: VimContext): void {
		this.ctx = ctx;
	}

	// ── Scope registration ──

	registerScope(scope: Scope): void {
		const handler = scope.register(null, null, (e: KeyboardEvent) => {
			return this.onKey(e);
		});
		this.scopeHandlers.push(handler);
	}

	unregisterScope(scope: Scope): void {
		for (const handler of this.scopeHandlers) {
			scope.unregister(handler);
		}
		this.scopeHandlers = [];
	}

	// ── Public API ──

	getMode(): VimMode { return this.mode; }
	getCursor(): CursorPosition { return { ...this.cursor }; }

	/** Suspend all key handling (for external popups like tag picker). */
	suspend(): void { this.suspended = true; }
	resume(): void { this.suspended = false; }

	setCursorFromClick(dayIndex: number, minutes: number): void {
		this.cursor = { dayIndex, minutes: this.snapMinutes(minutes) };
		this.renderCursor();
		this.updateIndicator();
	}

	restoreCursor(): void {
		if (this.mode !== "insert") {
			this.renderCursor();
			this.updateIndicator();
		}
	}

	enterInsertMode(): void {
		this.mode = "insert";
		this.ctx.clearCursor();
		this.updateIndicator();
	}

	exitInsertMode(): void {
		this.mode = "normal";
		this.renderCursor();
		this.updateIndicator();
		this.ctx.focusGrid();
	}

	destroy(): void {
		this.clearPending();
	}

	// ── Key dispatch ──

	private onKey(e: KeyboardEvent): boolean | void {
		// Skip all handling when suspended (external popup is open)
		if (this.suspended) return;

		// Skip if target is an input/textarea
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable) {
			return;
		}

		// Escape — handle in all modes, stopPropagation to prevent Obsidian focus switch
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			if (this.mode === "insert") {
				this.exitInsertMode();
			} else {
				this.actionEscape();
			}
			return false;
		}

		// Insert mode — let input handle everything else
		if (this.mode === "insert") {
			return;
		}

		// Ctrl combos
		if (e.ctrlKey || e.metaKey) {
			const action = this.ctrlKeyMap.get(e.key);
			if (action) {
				e.preventDefault();
				action();
				return false;
			}
			return;
		}

		const keyMap = this.mode === "visual" ? this.visualSingleKeyMap : this.singleKeyMap;
		const multiMap = this.mode === "visual" ? this.visualMultiKeyMap : this.multiKeyMap;

		// Shift combos (for H, L, V, G, O)
		if (e.shiftKey && e.key.length === 1) {
			const action = this.shiftKeyMap.get(e.key);
			if (action) {
				e.preventDefault();
				action();
				return false;
			}
		}

		const combo = this.pendingKeys + e.key;

		// Complete multi-key match
		if (multiMap.has(combo)) {
			this.clearPending();
			e.preventDefault();
			multiMap.get(combo)!();
			return false;
		}

		// Prefix match — wait for more
		if (this.isPrefix(combo)) {
			this.pendingKeys = combo;
			this.resetPendingTimeout();
			e.preventDefault();
			return false;
		}

		// Single key match (only if no pending)
		if (this.pendingKeys === "") {
			const action = keyMap.get(e.key);
			if (action) {
				e.preventDefault();
				action();
				return false;
			}
		}

		this.clearPending();
	}

	private isPrefix(combo: string): boolean {
		for (const key of this.multiKeyPrefixes) {
			if (key.startsWith(combo) && key !== combo) return true;
		}
		return false;
	}

	private clearPending(): void {
		this.pendingKeys = "";
		if (this.pendingTimeout) {
			clearTimeout(this.pendingTimeout);
			this.pendingTimeout = null;
		}
	}

	private resetPendingTimeout(): void {
		if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
		this.pendingTimeout = setTimeout(() => this.clearPending(), 1000);
	}

	// ── Key map construction ──

	private buildKeyMaps(): void {
		// ── Normal mode single keys ──
		this.singleKeyMap.set("h", () => this.moveHorizontal(-10));
		this.singleKeyMap.set("l", () => this.moveHorizontal(10));
		this.singleKeyMap.set("0", () => this.jumpLineStart());
		this.singleKeyMap.set("j", () => this.moveCursor(0, 60));
		this.singleKeyMap.set("k", () => this.moveCursor(0, -60));
		this.singleKeyMap.set("i", () => this.actionEdit());
		this.singleKeyMap.set("Enter", () => this.actionEdit());
		this.singleKeyMap.set("o", () => this.actionNewBlockBelow());
		this.singleKeyMap.set("x", () => this.actionToggleComplete());
		this.singleKeyMap.set("u", () => { this.ctx.undo(); });
		this.singleKeyMap.set("v", () => this.enterVisualMode());
		this.singleKeyMap.set("<", () => this.actionShiftBlock(-10));
		this.singleKeyMap.set(">", () => this.actionShiftBlock(10));
		this.singleKeyMap.set("+", () => this.actionResizeBlock(10));
		this.singleKeyMap.set("-", () => this.actionResizeBlock(-10));
		this.singleKeyMap.set("?", () => this.actionHelp());

		// ── Shift keys ──
		this.shiftKeyMap.set("H", () => this.moveCursorDay(-1));
		this.shiftKeyMap.set("L", () => this.moveCursorDay(1));
		this.shiftKeyMap.set("G", () => this.jumpEnd());
		this.shiftKeyMap.set("O", () => this.actionNewBlockAbove());
		this.shiftKeyMap.set("V", () => this.enterVisualModeLine());
		this.shiftKeyMap.set("$", () => this.jumpLineEnd());

		// ── Ctrl keys ──
		this.ctrlKeyMap.set("r", () => { this.ctx.redo(); });

		// ── Multi-key sequences ──
		this.multiKeyMap.set("gg", () => this.jumpStart());
		this.multiKeyMap.set("gt", () => this.jumpNow());
		this.multiKeyMap.set("dd", () => this.actionDelete());
		this.multiKeyMap.set("cc", () => this.actionChangeContent());
		this.multiKeyMap.set("cd", () => this.actionDefer());
		this.multiKeyMap.set("ct", () => this.actionChangeTag());
		this.multiKeyPrefixes.add("gg");
		this.multiKeyPrefixes.add("gt");
		this.multiKeyPrefixes.add("dd");
		this.multiKeyPrefixes.add("cc");
		this.multiKeyPrefixes.add("cd");
		this.multiKeyPrefixes.add("ct");

		// ── Visual mode keys ──
		this.visualSingleKeyMap.set("h", () => this.visualExtend(0, -10));
		this.visualSingleKeyMap.set("l", () => this.visualExtend(0, 10));
		this.visualSingleKeyMap.set("j", () => this.visualExtend(0, 60));
		this.visualSingleKeyMap.set("k", () => this.visualExtend(0, -60));
		this.visualSingleKeyMap.set("Enter", () => this.visualCreateBlock());

		this.visualMultiKeyMap.set("dd", () => this.visualDeleteBlocks());
	}

	// ── Cursor movement ──

	private snapMinutes(m: number): number {
		return Math.round(m / 10) * 10;
	}

	private moveCursor(dayDelta: number, minutesDelta: number): void {
		let newMinutes = this.cursor.minutes + minutesDelta;
		let newDay = this.cursor.dayIndex + dayDelta;

		// Clamp minutes to 0..1430
		newMinutes = Math.max(0, Math.min(1430, newMinutes));
		// Clamp day to visible range
		const minDay = this.ctx.dayOffset;
		const maxDay = this.ctx.dayOffset + this.ctx.visibleDays - 1;
		newDay = Math.max(minDay, Math.min(maxDay, newDay));

		this.cursor = { dayIndex: newDay, minutes: newMinutes };
		// Unfold if cursor moves into a folded time range
		this.ctx.unfoldIfNeeded(newMinutes);
		// Re-fold zones the cursor has left (normal mode only)
		if (this.mode === "normal") {
			this.ctx.refoldIfCursorLeft(newMinutes);
		}
		this.renderCursor();
		this.updateIndicator();
		this.ctx.scrollToMinutes(newMinutes);
	}

	/** Horizontal 10-min movement — wraps to adjacent day within the same hour row (visible range only). */
	private moveHorizontal(delta: number): void {
		let newMinutes = this.cursor.minutes + delta;
		let newDay = this.cursor.dayIndex;
		const hourStart = Math.floor(this.cursor.minutes / 60) * 60;
		const minDay = this.ctx.dayOffset;
		const maxDay = this.ctx.dayOffset + this.ctx.visibleDays - 1;

		if (newMinutes < hourStart) {
			newDay--;
			if (newDay < minDay) return;
			newMinutes = hourStart + 50;
		} else if (newMinutes > hourStart + 50) {
			newDay++;
			if (newDay > maxDay) return;
			newMinutes = hourStart;
		}

		this.cursor = { dayIndex: newDay, minutes: newMinutes };
		this.ctx.unfoldIfNeeded(newMinutes);
		if (this.mode === "normal") {
			this.ctx.refoldIfCursorLeft(newMinutes);
		}
		this.renderCursor();
		this.updateIndicator();
		this.ctx.scrollToMinutes(newMinutes);
	}

	private moveCursorDay(delta: number): void {
		let newDay = this.cursor.dayIndex + delta;

		// Cross week boundary
		if (newDay < 0) {
			this.cursor.dayIndex = 6;
			this.ctx.navigateWeek(-1, 6);
			return;
		}
		if (newDay > 6) {
			this.cursor.dayIndex = 0;
			this.ctx.navigateWeek(1, 0);
			return;
		}

		this.cursor.dayIndex = newDay;
		// Shift view if cursor moved outside visible range
		if (newDay < this.ctx.dayOffset || newDay >= this.ctx.dayOffset + this.ctx.visibleDays) {
			this.ctx.shiftView(newDay);
		}
		this.ctx.unfoldIfNeeded(this.cursor.minutes);
		if (this.mode === "normal") {
			this.ctx.refoldIfCursorLeft(this.cursor.minutes);
		}
		this.renderCursor();
		this.updateIndicator();
	}

	/** Jump to start of current hour row (XX:00). */
	private jumpLineStart(): void {
		this.cursor.minutes = Math.floor(this.cursor.minutes / 60) * 60;
		this.renderCursor();
		this.updateIndicator();
	}

	/** Jump to end of current hour row (XX:50). */
	private jumpLineEnd(): void {
		this.cursor.minutes = Math.floor(this.cursor.minutes / 60) * 60 + 50;
		this.renderCursor();
		this.updateIndicator();
	}

	private jumpStart(): void {
		this.cursor.minutes = this.ctx.settings.dayStartHour * 60;
		if (this.mode === "normal") this.ctx.refoldIfCursorLeft(this.cursor.minutes);
		this.renderCursor();
		this.updateIndicator();
		this.ctx.scrollToMinutes(this.cursor.minutes);
	}

	private jumpEnd(): void {
		this.cursor.minutes = Math.max(0, this.ctx.settings.dayEndHour * 60 - 10);
		this.ctx.unfoldIfNeeded(this.cursor.minutes);
		if (this.mode === "normal") this.ctx.refoldIfCursorLeft(this.cursor.minutes);
		this.renderCursor();
		this.updateIndicator();
		this.ctx.scrollToMinutes(this.cursor.minutes);
	}

	private jumpNow(): void {
		const now = new Date();
		const minutes = this.snapMinutes(now.getHours() * 60 + now.getMinutes());
		const today = window.moment().format("YYYY-MM-DD");
		const todayIdx = this.ctx.dates.findIndex(d => d.format("YYYY-MM-DD") === today);

		// Delegate entirely — navigateToToday handles week change, view shift, and cursor
		this.cursor.minutes = Math.min(minutes, 1430);
		this.ctx.navigateToToday();
	}

	// ── Block queries ──

	private getBlockAtCursor(): { dayIndex: number; item: TimelineItem } | null {
		const dateKey = this.ctx.dates[this.cursor.dayIndex]?.format("YYYY-MM-DD");
		if (!dateKey) return null;
		const items = this.ctx.weekData.get(dateKey) || [];
		for (const item of items) {
			const time = (item.checkbox === "actual" && item.actualTime) ? item.actualTime : item.planTime;
			if (this.cursor.minutes >= time.start && this.cursor.minutes < time.end) {
				return { dayIndex: this.cursor.dayIndex, item };
			}
		}
		return null;
	}

	// ── Block actions ──

	private actionEdit(): void {
		const block = this.getBlockAtCursor();
		if (block) {
			this.ctx.openBlockEdit(block.dayIndex, block.item);
		} else {
			// Open inline editor at cursor position (1 slot = 10 min)
			const start = this.cursor.minutes;
			const end = start + this.ctx.settings.defaultBlockDuration;
			this.enterInsertMode();
			this.ctx.openInlineEditor(this.cursor.dayIndex, start, end);
		}
	}

	private actionNewBlockBelow(): void {
		const block = this.getBlockAtCursor();
		const start = block
			? ((block.item.actualTime || block.item.planTime).end)
			: this.cursor.minutes;
		const end = start + this.ctx.settings.defaultBlockDuration;
		this.enterInsertMode();
		this.ctx.openInlineEditor(this.cursor.dayIndex, start, Math.min(end, 1440));
	}

	private actionNewBlockAbove(): void {
		const block = this.getBlockAtCursor();
		const end = block
			? (block.item.planTime.start)
			: this.cursor.minutes;
		const start = Math.max(0, end - this.ctx.settings.defaultBlockDuration);
		this.enterInsertMode();
		this.ctx.openInlineEditor(this.cursor.dayIndex, start, end);
	}

	private actionDelete(): void {
		const block = this.getBlockAtCursor();
		if (block) this.ctx.deleteBlock(block.dayIndex, block.item);
	}

	private actionToggleComplete(): void {
		const block = this.getBlockAtCursor();
		if (!block) return;
		if (block.item.checkbox === "plan") {
			this.ctx.completeBlock(block.dayIndex, block.item);
		} else if (block.item.checkbox === "actual") {
			this.ctx.uncompleteBlock(block.dayIndex, block.item);
		}
	}

	private actionShiftBlock(delta: number): void {
		const block = this.getBlockAtCursor();
		if (!block) return;
		const time = block.item.planTime;
		const newStart = Math.max(0, time.start + delta);
		const duration = time.end - time.start;
		if (newStart + duration > 1440) return;
		this.ctx.moveBlock(block.item, block.dayIndex, block.dayIndex, newStart);
	}

	private actionResizeBlock(delta: number): void {
		const block = this.getBlockAtCursor();
		if (!block) return;
		const time = (block.item.actualTime && block.item.checkbox === "actual")
			? block.item.actualTime : block.item.planTime;
		const newEnd = time.end + delta;
		if (newEnd <= time.start || newEnd > 1440) return;
		this.ctx.resizeBlock(block.item, block.dayIndex, time.start, newEnd);
	}

	private actionDefer(): void {
		const block = this.getBlockAtCursor();
		if (block) this.ctx.deferBlock(block.dayIndex, block.item);
	}

	private actionChangeTag(): void {
		const block = this.getBlockAtCursor();
		if (block) this.ctx.changeTag(block.dayIndex, block.item);
	}

	private actionChangeContent(): void {
		const block = this.getBlockAtCursor();
		if (block) {
			this.enterInsertMode();
			this.ctx.openBlockEdit(block.dayIndex, block.item);
		}
	}

	private actionEscape(): void {
		this.clearPending();
		if (this.mode === "visual") {
			this.exitVisualMode();
		}
	}

	private actionHelp(): void {
		this.ctx.showHelpModal();
	}

	// ── Visual mode ──

	private enterVisualMode(): void {
		this.mode = "visual";
		this.visual = {
			anchor: { ...this.cursor },
			head: { ...this.cursor },
		};
		this.renderVisual();
		this.updateIndicator();
	}

	private enterVisualModeLine(): void {
		this.mode = "visual";
		const hourStart = Math.floor(this.cursor.minutes / 60) * 60;
		this.visual = {
			anchor: { dayIndex: this.cursor.dayIndex, minutes: hourStart },
			head: { dayIndex: this.cursor.dayIndex, minutes: hourStart + 50 },
		};
		this.cursor = { ...this.visual.head };
		this.renderVisual();
		this.updateIndicator();
	}

	private exitVisualMode(): void {
		this.mode = "normal";
		this.visual = null;
		this.ctx.clearVisualHighlight();
		this.renderCursor();
		this.updateIndicator();
	}

	private visualExtend(dayDelta: number, minutesDelta: number): void {
		if (!this.visual) return;
		let newMinutes = this.visual.head.minutes + minutesDelta;
		let newDay = this.visual.head.dayIndex + dayDelta;
		newMinutes = Math.max(0, Math.min(1430, newMinutes));
		newDay = Math.max(0, Math.min(6, newDay));
		this.visual.head = { dayIndex: newDay, minutes: newMinutes };
		this.cursor = { ...this.visual.head };
		this.renderVisual();
		this.updateIndicator();
		this.ctx.scrollToMinutes(newMinutes);
	}

	private getVisualRange(): { dayIndex: number; start: number; end: number } | null {
		if (!this.visual) return null;
		const a = this.visual.anchor;
		const h = this.visual.head;
		// Visual selection is only within same day
		const dayIndex = a.dayIndex;
		const start = Math.min(a.minutes, h.minutes);
		const end = Math.max(a.minutes, h.minutes) + 10; // include the head slot
		return { dayIndex, start, end };
	}

	private visualCreateBlock(): void {
		const range = this.getVisualRange();
		if (!range) return;
		this.mode = "normal";
		this.visual = null;
		this.ctx.clearVisualHighlight();
		this.enterInsertMode();
		this.ctx.openInlineEditor(range.dayIndex, range.start, range.end);
	}

	private visualDeleteBlocks(): void {
		const range = this.getVisualRange();
		if (!range) return;
		const dateKey = this.ctx.dates[range.dayIndex]?.format("YYYY-MM-DD");
		if (!dateKey) return;
		const items = this.ctx.weekData.get(dateKey) || [];
		for (const item of items) {
			const time = (item.checkbox === "actual" && item.actualTime) ? item.actualTime : item.planTime;
			if (time.start < range.end && time.end > range.start) {
				this.ctx.deleteBlock(range.dayIndex, item);
			}
		}
		this.exitVisualMode();
	}

	// ── Rendering helpers ──

	private renderCursor(): void {
		this.ctx.renderCursor(this.cursor);
	}

	private renderVisual(): void {
		const range = this.getVisualRange();
		if (range) {
			this.ctx.clearCursor();
			this.ctx.renderVisualHighlight(range.start, range.end, range.dayIndex);
		}
	}

	private updateIndicator(): void {
		const formatTime = (m: number) => {
			const h = Math.floor(m / 60);
			const min = m % 60;
			return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
		};

		let info: string;
		if (this.mode === "visual" && this.visual) {
			const range = this.getVisualRange()!;
			const duration = range.end - range.start;
			const hours = duration / 60;
			info = `${formatTime(range.start)} → ${formatTime(range.end)} (${hours >= 1 ? hours + "h" : duration + "m"})`;
		} else {
			info = formatTime(this.cursor.minutes);
		}

		this.ctx.updateModeIndicator(this.mode, info);
	}
}
