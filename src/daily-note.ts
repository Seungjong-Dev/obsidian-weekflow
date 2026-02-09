import { type Vault, normalizePath, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { TimelineItem, WeekFlowSettings } from "./types";
import { parseTimelineItems, serializeTimelineItem, updateTimelineSection } from "./parser";

/**
 * Resolve a daily note path from a moment.js pattern + date.
 * Always appends .md extension.
 */
export function resolveDailyNotePath(
	pattern: string,
	date: Moment
): string {
	return normalizePath(date.format(pattern) + ".md");
}

/**
 * Read timeline items from a daily note for a given date.
 */
export async function getDailyNoteItems(
	vault: Vault,
	date: Moment,
	settings: WeekFlowSettings
): Promise<TimelineItem[]> {
	const path = resolveDailyNotePath(settings.dailyNotePath, date);
	const file = vault.getAbstractFileByPath(path);
	if (!file || !("extension" in file)) return [];

	const content = await vault.read(file as any);
	return parseTimelineItems(content, settings.timelineHeading);
}

/**
 * Save timeline items to a daily note for a given date.
 * - If file exists: replace the timeline section (or append heading if missing).
 * - If file doesn't exist: create it with just the heading + items.
 */
export async function saveDailyNoteItems(
	vault: Vault,
	date: Moment,
	settings: WeekFlowSettings,
	items: TimelineItem[]
): Promise<void> {
	const path = resolveDailyNotePath(settings.dailyNotePath, date);
	const file = vault.getAbstractFileByPath(path);

	if (file && "extension" in file) {
		const content = await vault.read(file as any);
		const updated = updateTimelineSection(
			content,
			settings.timelineHeading,
			items
		);
		await vault.modify(file as any, updated);
	} else {
		// Create new file with heading + items
		const serialized = items.map(serializeTimelineItem).join("\n");
		const content = `${settings.timelineHeading}\n${serialized}\n`;

		// Ensure parent folders exist
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (dir) {
			await ensureFolderExists(vault, dir);
		}
		await vault.create(path, content);
	}
}

async function ensureFolderExists(vault: Vault, dir: string): Promise<void> {
	if (vault.getAbstractFileByPath(dir)) return;
	const parent = dir.substring(0, dir.lastIndexOf("/"));
	if (parent) {
		await ensureFolderExists(vault, parent);
	}
	try {
		await vault.createFolder(dir);
	} catch {
		// folder may have been created concurrently
	}
}

/**
 * Get the 7 dates for a week containing the reference date.
 */
export function getWeekDates(
	referenceDate: Moment,
	weekStartDay: number
): Moment[] {
	const ref = referenceDate.clone().startOf("day");
	// Calculate offset to week start
	let dayOfWeek = ref.day(); // 0=Sun
	let diff = dayOfWeek - weekStartDay;
	if (diff < 0) diff += 7;
	const weekStart = ref.clone().subtract(diff, "days");

	const dates: Moment[] = [];
	for (let i = 0; i < 7; i++) {
		dates.push(weekStart.clone().add(i, "days"));
	}
	return dates;
}

/**
 * Load timeline data for an entire week.
 * Returns a Map keyed by date string (YYYY-MM-DD) → items.
 */
export async function loadWeekData(
	vault: Vault,
	dates: Moment[],
	settings: WeekFlowSettings
): Promise<Map<string, TimelineItem[]>> {
	const result = new Map<string, TimelineItem[]>();
	const promises = dates.map(async (date) => {
		const items = await getDailyNoteItems(vault, date, settings);
		result.set(date.format("YYYY-MM-DD"), items);
	});
	await Promise.all(promises);
	return result;
}
