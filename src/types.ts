export type CheckboxState = "plan" | "actual" | "deferred";

export interface TimeRange {
	start: number; // minutes from midnight (e.g., 540 = 09:00)
	end: number;
}

export interface TimelineItem {
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

export interface WeekFlowSettings {
	dailyNotePath: string;
	timelineHeading: string;
	dayStartHour: number;
	dayEndHour: number;
	weekStartDay: number; // 0=Sun, 1=Mon, ...
	defaultMode: "plan" | "actual";
	categories: Category[];
}

export const DEFAULT_SETTINGS: WeekFlowSettings = {
	dailyNotePath: "YYYY-MM-DD",
	timelineHeading: "## Timeline",
	dayStartHour: 6,
	dayEndHour: 24,
	weekStartDay: 1,
	defaultMode: "plan",
	categories: [
		{ tag: "work", label: "업무", color: "#4A90D9" },
		{ tag: "study", label: "학업", color: "#7ED321" },
		{ tag: "exercise", label: "운동", color: "#F5A623" },
		{ tag: "rest", label: "휴식", color: "#9B9B9B" },
		{ tag: "personal", label: "개인", color: "#BD10E0" },
	],
};

export const VIEW_TYPE_WEEKFLOW = "weekflow-view";
