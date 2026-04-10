/**
 * WeekFlow Digest — pure data refinement for external agent consumption.
 * No UI dependencies; operates on parsed data + settings only.
 */

import type { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { TimelineItem, WeekFlowSettings, CategoryStats, ProjectStats, PlanActualSummary } from "./types";
import { formatTime } from "./parser";
import { calculateCategoryStats, calculateProjectStats, calculatePlanActualSummary } from "./statistics";

// ── Public digest types ──

export interface DigestTimeRange {
	start: string; // "HH:MM"
	end: string;   // "HH:MM"
	minutes: number;
}

export interface DigestItem {
	index: number;
	content: string;
	tags: string[];
	type: "plan" | "actual" | "deferred";
	planTime: DigestTimeRange;
	actualTime?: DigestTimeRange;
}

export interface DigestDaySummary {
	planMinutes: number;
	actualMinutes: number;
	planCount: number;
	actualCount: number;
	deferredCount: number;
}

export interface DigestDay {
	date: string;     // "YYYY-MM-DD"
	weekday: string;  // "Mon", "Tue", ...
	items: DigestItem[];
	review: string | null;
	summary: DigestDaySummary;
}

export interface DigestStats {
	totalPlanMinutes: number;
	totalActualMinutes: number;
	completionRate: number;
	deferredRate: number;
	totalPlanItems: number;
	completedItems: number;
	deferredItems: number;
	categoryBreakdown: Array<{
		tag: string;
		label: string;
		planMinutes: number;
		actualMinutes: number;
		achievementRate: number;
	}>;
	projectBreakdown: Array<{
		name: string;
		planMinutes: number;
		actualMinutes: number;
	}>;
}

export interface WeekFlowDigest {
	period: { start: string; end: string };
	daily: DigestDay[];
	stats: DigestStats;
}

// ── Conversion helpers ──

function toDigestTimeRange(start: number, end: number): DigestTimeRange {
	return {
		start: formatTime(start),
		end: formatTime(end),
		minutes: end - start,
	};
}

export function toDigestItem(item: TimelineItem, index: number): DigestItem {
	const result: DigestItem = {
		index,
		content: item.content,
		tags: [...item.tags],
		type: item.checkbox,
		planTime: toDigestTimeRange(item.planTime.start, item.planTime.end),
	};
	if (item.actualTime) {
		result.actualTime = toDigestTimeRange(item.actualTime.start, item.actualTime.end);
	}
	return result;
}

export function toDigestDaySummary(items: TimelineItem[]): DigestDaySummary {
	let planMinutes = 0;
	let actualMinutes = 0;
	let planCount = 0;
	let actualCount = 0;
	let deferredCount = 0;

	for (const item of items) {
		if (item.checkbox === "plan") {
			planMinutes += item.planTime.end - item.planTime.start;
			planCount++;
		} else if (item.checkbox === "actual") {
			const range = item.actualTime || item.planTime;
			actualMinutes += range.end - range.start;
			planMinutes += item.planTime.end - item.planTime.start;
			actualCount++;
		} else if (item.checkbox === "deferred") {
			planMinutes += item.planTime.end - item.planTime.start;
			deferredCount++;
		}
	}

	return { planMinutes, actualMinutes, planCount, actualCount, deferredCount };
}

// ── Main digest builder ──

export function buildDigest(
	dates: Moment[],
	weekData: Map<string, TimelineItem[]>,
	reviewData: Map<string, string>,
	settings: WeekFlowSettings
): WeekFlowDigest {
	const allItems: TimelineItem[] = [];
	const daily: DigestDay[] = [];

	for (const date of dates) {
		const dateKey = date.format("YYYY-MM-DD");
		const items = weekData.get(dateKey) || [];
		allItems.push(...items);

		const reviewText = reviewData.get(dateKey) || "";

		daily.push({
			date: dateKey,
			weekday: date.format("ddd"),
			items: items.map((item, idx) => toDigestItem(item, idx)),
			review: reviewText || null,
			summary: toDigestDaySummary(items),
		});
	}

	// Aggregate stats
	const categoryStats = calculateCategoryStats(allItems, settings.categories);
	const projectStats = calculateProjectStats(allItems);
	const summary = calculatePlanActualSummary(allItems);

	return {
		period: {
			start: dates[0].format("YYYY-MM-DD"),
			end: dates[dates.length - 1].format("YYYY-MM-DD"),
		},
		daily,
		stats: {
			totalPlanMinutes: summary.totalPlanItems > 0
				? categoryStats.reduce((sum, c) => sum + c.planMinutes, 0)
				: 0,
			totalActualMinutes: categoryStats.reduce((sum, c) => sum + c.actualMinutes, 0),
			completionRate: summary.completionRate,
			deferredRate: summary.deferredRate,
			totalPlanItems: summary.totalPlanItems,
			completedItems: summary.completedItems,
			deferredItems: summary.deferredItems,
			categoryBreakdown: categoryStats.map((c) => ({
				tag: c.tag,
				label: c.label,
				planMinutes: c.planMinutes,
				actualMinutes: c.actualMinutes,
				achievementRate: c.achievementRate,
			})),
			projectBreakdown: projectStats.map((p) => ({
				name: p.projectName,
				planMinutes: p.planMinutes,
				actualMinutes: p.actualMinutes,
			})),
		},
	};
}
