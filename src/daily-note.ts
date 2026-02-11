import { type App, type Vault, normalizePath, moment, TFile } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { ParseWarning, TimelineItem, WeekFlowSettings } from "./types";
import { parseTimelineItems, parseCheckboxItems, serializeTimelineItem, updateTimelineSection, extractBlockId } from "./parser";
import type { CheckboxItem } from "./parser";

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
): Promise<{ items: TimelineItem[]; warnings: ParseWarning[] }> {
	const path = resolveDailyNotePath(settings.dailyNotePath, date);
	const file = vault.getAbstractFileByPath(path);
	if (!file || !("extension" in file)) return { items: [], warnings: [] };

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

export interface WeekDataResult {
	weekData: Map<string, TimelineItem[]>;
	warnings: Map<string, ParseWarning[]>;
}

/**
 * Load timeline data for an entire week.
 * Returns a Map keyed by date string (YYYY-MM-DD) → items, plus warnings.
 */
export async function loadWeekData(
	vault: Vault,
	dates: Moment[],
	settings: WeekFlowSettings
): Promise<WeekDataResult> {
	const weekData = new Map<string, TimelineItem[]>();
	const warnings = new Map<string, ParseWarning[]>();
	const promises = dates.map(async (date) => {
		const result = await getDailyNoteItems(vault, date, settings);
		const dateKey = date.format("YYYY-MM-DD");
		weekData.set(dateKey, result.items);
		if (result.warnings.length > 0) {
			warnings.set(dateKey, result.warnings);
		}
	});
	await Promise.all(promises);
	return { weekData, warnings };
}

/**
 * Get the resolved file paths for all 7 daily notes in the current week.
 */
export function getWeekNotePaths(
	dates: Moment[],
	settings: WeekFlowSettings
): string[] {
	return dates.map((date) => resolveDailyNotePath(settings.dailyNotePath, date));
}

// ── Inbox I/O ──

/**
 * Resolve inbox note path from a moment.js pattern (uses current date).
 */
export function resolveInboxNotePath(pattern: string): string {
	return normalizePath(window.moment().format(pattern) + ".md");
}

/**
 * Read unchecked checkbox items from the inbox note.
 */
export async function getInboxItems(
	vault: Vault,
	settings: WeekFlowSettings
): Promise<CheckboxItem[]> {
	const path = resolveInboxNotePath(settings.inboxNotePath);
	const file = vault.getAbstractFileByPath(path);
	if (!file || !("extension" in file)) return [];

	const content = await vault.read(file as any);
	return parseCheckboxItems(content, settings.inboxHeading);
}

/**
 * Add a checkbox line to the inbox note under the configured heading.
 * Creates the note and/or heading if they don't exist.
 */
export async function addToInbox(
	vault: Vault,
	settings: WeekFlowSettings,
	line: string
): Promise<void> {
	const path = resolveInboxNotePath(settings.inboxNotePath);
	const file = vault.getAbstractFileByPath(path);

	if (file && "extension" in file) {
		const content = await vault.read(file as any);
		const heading = settings.inboxHeading;
		const headingLevel = (heading.match(/^#+/) || [""])[0].length;
		const lines = content.split("\n");

		let insertIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === heading.trim()) {
				// Find the end of items under this heading
				let j = i + 1;
				for (; j < lines.length; j++) {
					const match = lines[j].match(/^(#+)\s/);
					if (match && match[1].length <= headingLevel) break;
				}
				insertIdx = j;
				break;
			}
		}

		if (insertIdx === -1) {
			// Heading not found: append heading + line at end
			const suffix = content.endsWith("\n") ? "" : "\n";
			const updated = content + suffix + "\n" + heading + "\n" + line + "\n";
			await vault.modify(file as any, updated);
		} else {
			lines.splice(insertIdx, 0, line);
			await vault.modify(file as any, lines.join("\n"));
		}
	} else {
		// Create new file
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (dir) {
			await ensureFolderExists(vault, dir);
		}
		const content = `${settings.inboxHeading}\n${line}\n`;
		await vault.create(path, content);
	}
}

// ── Project I/O ──

export interface ProjectInfo {
	path: string;
	title: string;
}

/**
 * Find all active project notes based on tag and status frontmatter.
 */
export function getActiveProjects(
	app: App,
	settings: WeekFlowSettings
): ProjectInfo[] {
	const projects: ProjectInfo[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		// Check tags: frontmatter tags + inline tags
		const fmTags = (cache.frontmatter?.tags || []).map((t: string) =>
			t.replace(/^#/, "")
		);
		const inlineTags = (cache.tags || []).map((t) =>
			t.tag.replace(/^#/, "")
		);
		const allTags = [...fmTags, ...inlineTags];
		if (!allTags.includes(settings.projectTag)) continue;

		// Check status
		const status = cache.frontmatter?.[settings.projectStatusField];
		if (!status || !settings.projectActiveStatuses.includes(status))
			continue;

		projects.push({ path: file.path, title: file.basename });
	}
	return projects;
}

/**
 * Read unchecked tasks from a project note under the configured heading.
 */
export async function getProjectTasks(
	vault: Vault,
	projectPath: string,
	heading: string
): Promise<CheckboxItem[]> {
	const file = vault.getAbstractFileByPath(projectPath);
	if (!file || !(file instanceof TFile)) return [];
	const content = await vault.read(file);
	return parseCheckboxItems(content, heading);
}

/**
 * Append a block ID to a specific line in a file.
 */
export async function appendBlockIdToLine(
	vault: Vault,
	filePath: string,
	lineNumber: number,
	blockId: string
): Promise<void> {
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || !(file instanceof TFile)) return;
	const content = await vault.read(file);
	const lines = content.split("\n");
	if (lineNumber < 0 || lineNumber >= lines.length) return;
	lines[lineNumber] = lines[lineNumber].trimEnd() + ` ^${blockId}`;
	await vault.modify(file, lines.join("\n"));
}

/**
 * Complete a project task by finding the line with a given block ID
 * and changing `- [ ]` to `- [x]`.
 */
export async function completeProjectTask(
	vault: Vault,
	projectPath: string,
	blockId: string
): Promise<boolean> {
	const file = vault.getAbstractFileByPath(projectPath);
	if (!file || !(file instanceof TFile)) return false;
	const content = await vault.read(file);
	const lines = content.split("\n");
	let changed = false;
	for (let i = 0; i < lines.length; i++) {
		const id = extractBlockId(lines[i]);
		if (id === blockId && lines[i].match(/^- \[ \]/)) {
			lines[i] = lines[i].replace(/^- \[ \]/, "- [x]");
			changed = true;
			break;
		}
	}
	if (changed) {
		await vault.modify(file, lines.join("\n"));
	}
	return changed;
}
