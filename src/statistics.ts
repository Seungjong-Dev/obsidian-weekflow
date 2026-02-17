import type { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { Category, CategoryStats, PlanActualSummary, ProjectStats, StatisticsRange, TimelineItem } from "./types";

/**
 * Calculate per-category time statistics from timeline items.
 * Groups by first tag, aggregates plan/actual minutes.
 */
export function calculateCategoryStats(
	items: TimelineItem[],
	categories: Category[]
): CategoryStats[] {
	const catMap = new Map<string, { planMinutes: number; actualMinutes: number }>();

	// Initialize from known categories
	for (const cat of categories) {
		catMap.set(cat.tag, { planMinutes: 0, actualMinutes: 0 });
	}

	for (const item of items) {
		const tag = item.tags[0] || "untagged";
		if (!catMap.has(tag)) {
			catMap.set(tag, { planMinutes: 0, actualMinutes: 0 });
		}
		const entry = catMap.get(tag)!;

		if (item.checkbox === "plan" || item.checkbox === "deferred") {
			entry.planMinutes += item.planTime.end - item.planTime.start;
		} else if (item.checkbox === "actual") {
			const actualRange = item.actualTime || item.planTime;
			entry.actualMinutes += actualRange.end - actualRange.start;
			// Also count the plan portion
			entry.planMinutes += item.planTime.end - item.planTime.start;
		}
	}

	const results: CategoryStats[] = [];
	for (const [tag, data] of catMap) {
		if (data.planMinutes === 0 && data.actualMinutes === 0) continue;

		const cat = categories.find((c) => c.tag === tag);
		results.push({
			tag,
			label: cat?.label || tag,
			color: cat?.color || "#888888",
			planMinutes: data.planMinutes,
			actualMinutes: data.actualMinutes,
			achievementRate:
				data.planMinutes > 0
					? Math.round((data.actualMinutes / data.planMinutes) * 100)
					: data.actualMinutes > 0
						? 100
						: 0,
		});
	}

	// Sort by actual minutes descending
	results.sort((a, b) => b.actualMinutes - a.actualMinutes);
	return results;
}

/**
 * Calculate per-project time statistics.
 * Extracts project names from [[ProjectName#^...]] patterns in content.
 */
export function calculateProjectStats(
	items: TimelineItem[]
): ProjectStats[] {
	const projectMap = new Map<string, { planMinutes: number; actualMinutes: number }>();

	const projectLinkRe = /\[\[([^#\]]+)#\^[a-zA-Z0-9-]+\]\]/;

	for (const item of items) {
		const match = projectLinkRe.exec(item.content);
		if (!match) continue;

		const projectName = match[1];
		if (!projectMap.has(projectName)) {
			projectMap.set(projectName, { planMinutes: 0, actualMinutes: 0 });
		}
		const entry = projectMap.get(projectName)!;

		if (item.checkbox === "plan" || item.checkbox === "deferred") {
			entry.planMinutes += item.planTime.end - item.planTime.start;
		} else if (item.checkbox === "actual") {
			const actualRange = item.actualTime || item.planTime;
			entry.actualMinutes += actualRange.end - actualRange.start;
			entry.planMinutes += item.planTime.end - item.planTime.start;
		}
	}

	const results: ProjectStats[] = [];
	for (const [projectName, data] of projectMap) {
		results.push({
			projectName,
			planMinutes: data.planMinutes,
			actualMinutes: data.actualMinutes,
		});
	}

	results.sort((a, b) => b.actualMinutes - a.actualMinutes);
	return results;
}

/**
 * Calculate plan vs actual summary statistics.
 */
export function calculatePlanActualSummary(
	items: TimelineItem[]
): PlanActualSummary {
	let totalPlanItems = 0;
	let completedItems = 0;
	let deferredItems = 0;
	let unplannedActualItems = 0;

	// Collect plan contents for "unplanned" detection
	const planContents = new Set<string>();
	for (const item of items) {
		if (item.checkbox === "plan") {
			planContents.add(item.content);
		}
	}

	for (const item of items) {
		if (item.checkbox === "plan") {
			totalPlanItems++;
		} else if (item.checkbox === "actual") {
			completedItems++;
			totalPlanItems++; // actual items started as plans
			// Check if this actual had no corresponding plan content
			if (!planContents.has(item.content) && !item.actualTime) {
				unplannedActualItems++;
			}
		} else if (item.checkbox === "deferred") {
			totalPlanItems++;
			deferredItems++;
		}
	}

	const completionRate =
		totalPlanItems > 0 ? Math.round((completedItems / totalPlanItems) * 100) : 0;
	const deferredRate =
		totalPlanItems > 0 ? Math.round((deferredItems / totalPlanItems) * 100) : 0;

	return {
		totalPlanItems,
		completedItems,
		deferredItems,
		unplannedActualItems,
		completionRate,
		deferredRate,
	};
}

/**
 * Format minutes as hours string (e.g., 90 → "1.5h").
 */
export function formatHours(minutes: number): string {
	const hours = minutes / 60;
	if (hours === 0) return "0h";
	if (hours === Math.floor(hours)) return `${hours}h`;
	return `${hours.toFixed(1)}h`;
}

// ── Burning Rate (Trend) Chart ──

export interface BurningRatePoint {
	label: string;
	categoryMinutes: Map<string, number>; // tag → actual minutes
}

/**
 * Calculate burning rate points from dated items.
 * Items must be associated with dates via dateItemsMap.
 */
export function calculateBurningRateFromDateItems(
	dateItemsMap: Map<string, TimelineItem[]>,
	dates: Moment[],
	range: StatisticsRange,
	weekStartDay: number
): BurningRatePoint[] {
	const points: BurningRatePoint[] = [];

	if (range === "weekly") {
		// Daily points
		for (const date of dates) {
			const dateKey = date.format("YYYY-MM-DD");
			const items = dateItemsMap.get(dateKey) || [];
			const catMap = new Map<string, number>();
			for (const item of items) {
				if (item.checkbox !== "actual") continue;
				const tag = item.tags[0] || "untagged";
				const range = item.actualTime || item.planTime;
				const mins = range.end - range.start;
				catMap.set(tag, (catMap.get(tag) || 0) + mins);
			}
			points.push({ label: date.format("ddd"), categoryMinutes: catMap });
		}
	} else if (range === "monthly") {
		// Weekly points
		const weekBuckets = new Map<string, Map<string, number>>();
		const weekOrder: string[] = [];

		for (const date of dates) {
			const weekLabel = date.format("[W]ww");
			if (!weekBuckets.has(weekLabel)) {
				weekBuckets.set(weekLabel, new Map());
				weekOrder.push(weekLabel);
			}
			const dateKey = date.format("YYYY-MM-DD");
			const items = dateItemsMap.get(dateKey) || [];
			const bucket = weekBuckets.get(weekLabel)!;
			for (const item of items) {
				if (item.checkbox !== "actual") continue;
				const tag = item.tags[0] || "untagged";
				const r = item.actualTime || item.planTime;
				bucket.set(tag, (bucket.get(tag) || 0) + (r.end - r.start));
			}
		}

		for (const label of weekOrder) {
			points.push({ label, categoryMinutes: weekBuckets.get(label)! });
		}
	} else {
		// Quarterly / Yearly → monthly points
		const monthBuckets = new Map<string, Map<string, number>>();
		const monthOrder: string[] = [];

		for (const date of dates) {
			const monthLabel = date.format("MMM");
			if (!monthBuckets.has(monthLabel)) {
				monthBuckets.set(monthLabel, new Map());
				monthOrder.push(monthLabel);
			}
			const dateKey = date.format("YYYY-MM-DD");
			const items = dateItemsMap.get(dateKey) || [];
			const bucket = monthBuckets.get(monthLabel)!;
			for (const item of items) {
				if (item.checkbox !== "actual") continue;
				const tag = item.tags[0] || "untagged";
				const r = item.actualTime || item.planTime;
				bucket.set(tag, (bucket.get(tag) || 0) + (r.end - r.start));
			}
		}

		for (const label of monthOrder) {
			points.push({ label, categoryMinutes: monthBuckets.get(label)! });
		}
	}

	return points;
}

// ── Time Distribution ──

export interface TimeDistributionPoint {
	label: string;
	totalMinutes: number;
}

/**
 * Calculate time distribution (total actual minutes per sub-period).
 */
export function calculateTimeDistribution(
	dateItemsMap: Map<string, TimelineItem[]>,
	dates: Moment[],
	range: StatisticsRange
): TimeDistributionPoint[] {
	const points: TimeDistributionPoint[] = [];

	if (range === "weekly") {
		// Per day of week
		for (const date of dates) {
			const dateKey = date.format("YYYY-MM-DD");
			const items = dateItemsMap.get(dateKey) || [];
			let total = 0;
			for (const item of items) {
				if (item.checkbox !== "actual") continue;
				const r = item.actualTime || item.planTime;
				total += r.end - r.start;
			}
			points.push({ label: date.format("ddd"), totalMinutes: total });
		}
	} else if (range === "monthly") {
		// Per week
		const weekBuckets = new Map<string, number>();
		const weekOrder: string[] = [];

		for (const date of dates) {
			const weekLabel = date.format("[W]ww");
			if (!weekBuckets.has(weekLabel)) {
				weekBuckets.set(weekLabel, 0);
				weekOrder.push(weekLabel);
			}
			const dateKey = date.format("YYYY-MM-DD");
			const items = dateItemsMap.get(dateKey) || [];
			for (const item of items) {
				if (item.checkbox !== "actual") continue;
				const r = item.actualTime || item.planTime;
				weekBuckets.set(weekLabel, weekBuckets.get(weekLabel)! + (r.end - r.start));
			}
		}

		for (const label of weekOrder) {
			points.push({ label, totalMinutes: weekBuckets.get(label)! });
		}
	} else {
		// Per month
		const monthBuckets = new Map<string, number>();
		const monthOrder: string[] = [];

		for (const date of dates) {
			const monthLabel = date.format("MMM");
			if (!monthBuckets.has(monthLabel)) {
				monthBuckets.set(monthLabel, 0);
				monthOrder.push(monthLabel);
			}
			const dateKey = date.format("YYYY-MM-DD");
			const items = dateItemsMap.get(dateKey) || [];
			for (const item of items) {
				if (item.checkbox !== "actual") continue;
				const r = item.actualTime || item.planTime;
				monthBuckets.set(monthLabel, monthBuckets.get(monthLabel)! + (r.end - r.start));
			}
		}

		for (const label of monthOrder) {
			points.push({ label, totalMinutes: monthBuckets.get(label)! });
		}
	}

	return points;
}
