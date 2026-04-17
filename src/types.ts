export type CheckboxState = "plan" | "actual" | "deferred";

export interface TimeRange {
	start: number; // minutes from midnight (e.g., 540 = 09:00)
	end: number;
}

export interface TimelineItem {
	id: string;
	checkbox: CheckboxState;
	planTime: TimeRange;
	actualTime?: TimeRange;
	content: string;
	tags: string[];
	rawSuffix: string;
	lineNumber?: number;
}

export interface Category {
	tag: string;
	label: string;
	color: string;
}

export interface PresetSlot {
	start: number; // minutes from midnight
	end: number;
	content: string;
	tag: string;
}

export interface TimeSlotPreset {
	name: string;
	slots: PresetSlot[];
}

export interface CalendarSource {
	id: string;
	name: string;
	url: string;
	color: string;
	enabled: boolean;
}

export interface CalendarEvent {
	uid: string;
	summary: string;
	start: Date;
	end: Date;
	allDay: boolean;
	sourceId: string;
	color: string;
}

export interface LogItem {
	timeMinutes: number;
	content: string;
	lineNumber: number;
}

export interface InboxSource {
	path: string;    // note path (e.g., "Inbox.md") or folder path (e.g., "Projects/Active")
	heading: string; // heading to scope reads/writes; empty string = entire note
}

export interface WeekFlowSettings {
	dailyNotePath: string;
	dailyNoteTemplatePath: string;
	weeklyNotePath: string;
	weeklyNoteTemplatePath: string;
	timelineHeading: string;
	dayStartHour: number;
	dayEndHour: number;
	weekStartDay: number; // 0=Sun, 1=Mon, ...
	defaultMode: "plan" | "actual";
	categories: Category[];
	inboxSources: InboxSource[];
	defaultBlockDuration: number; // minutes
	planningPanelOpen: boolean;

	// Project integration
	projectTag: string;
	projectStatusField: string;
	projectActiveStatuses: string[];
	projectTasksHeading: string;

	// Presets
	presets: TimeSlotPreset[];

	// Review
	reviewHeading: string;
	reviewPanelOpen: boolean;
	reviewPanelHeight: number; // px, 0 = auto
	reviewPanelMode: "review" | "log";

	// Logs
	logsHeading: string;
	logTimestampFormat: string; // moment.js format, e.g. "HH:mm"

	// Calendar
	calendarSources: CalendarSource[];
	calendarCacheDuration: number; // minutes

	// Vim keyboard mode
	vimMode: boolean;
}

export const DEFAULT_SETTINGS: WeekFlowSettings = {
	dailyNotePath: "YYYY-MM-DD",
	dailyNoteTemplatePath: "",
	weeklyNotePath: "YYYY-[W]ww",
	weeklyNoteTemplatePath: "",
	timelineHeading: "## Timeline",
	dayStartHour: 6,
	dayEndHour: 24,
	weekStartDay: 1,
	defaultMode: "plan",
	categories: [
		{ tag: "work", label: "Work", color: "#4A90D9" },
		{ tag: "personal", label: "Personal", color: "#BD10E0" },
	],
	inboxSources: [{ path: "Inbox.md", heading: "" }],
	defaultBlockDuration: 60,
	planningPanelOpen: true,
	projectTag: "type/project",
	projectStatusField: "status",
	projectActiveStatuses: ["🟡 In Progress", "🔴 Urgent"],
	projectTasksHeading: "## Tasks",
	presets: [],
	reviewHeading: "## Review",
	reviewPanelOpen: true,
	reviewPanelHeight: 160,
	reviewPanelMode: "log",
	logsHeading: "## Logs",
	logTimestampFormat: "HH:mm",
	calendarSources: [],
	calendarCacheDuration: 30,
	vimMode: true,
};

export interface ParseWarning {
	line: number;
	message: string;
}

export interface ParseResult {
	items: TimelineItem[];
	warnings: ParseWarning[];
}

export const VIEW_TYPE_WEEKFLOW = "weekflow-view";
export const VIEW_TYPE_WEEKFLOW_STATS = "weekflow-stats-view";

export type StatisticsRange = "weekly" | "monthly" | "quarterly" | "yearly";

export interface CategoryStats {
	tag: string;
	label: string;
	color: string;
	planMinutes: number;
	actualMinutes: number;
	achievementRate: number;
}

export interface ProjectStats {
	projectName: string;
	planMinutes: number;
	actualMinutes: number;
}

export interface PlanActualSummary {
	totalPlanItems: number;
	completedItems: number;
	deferredItems: number;
	unplannedActualItems: number;
	completionRate: number;
	deferredRate: number;
}

// Planning Panel types

// Grid swipe callbacks (for responsive navigation)
export interface SwipeCallbacks {
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
}

export type PanelItemSource =
	| { type: "overdue"; dateKey: string; planTime: TimeRange; originalId: string; lineNumber?: number }
	| { type: "inbox"; notePath: string; lineNumber: number }
	| { type: "project"; projectPath: string; blockId?: string };

export interface PanelItem {
	id: string;
	content: string;
	tags: string[];
	rawSuffix: string;
	source: PanelItemSource;
}
