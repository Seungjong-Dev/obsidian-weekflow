import { type App, type Vault, normalizePath, moment, TFile, TFolder } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { InboxSource, ParseWarning, TimelineItem, WeekFlowSettings } from "./types";
import { parseTimelineItems, parseCheckboxItems, serializeTimelineItem, updateTimelineSection, extractBlockId, parseReviewContent, updateReviewSection } from "./parser";
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
 * Convert a moment.js daily-note path pattern into a RegExp that matches
 * any resolved daily-note file path (with .md extension).
 *
 * Strategy: replace moment tokens with placeholder strings, escape regex
 * literals, then restore placeholders as capture patterns.
 */
function buildDailyNotePathRegex(pattern: string): RegExp {
	// Moment tokens sorted longest-first to avoid partial matches
	const tokenMap: [string, string][] = [
		["YYYY", "\\d{4}"],
		["YY", "\\d{2}"],
		["MMMM", "[^\\\\/]+"],  // Full month name (locale-dependent)
		["MMM", "[^\\\\/]+"],   // Abbreviated month name
		["MM", "\\d{2}"],
		["Mo", "\\d{1,2}(?:st|nd|rd|th)"],
		["M", "\\d{1,2}"],
		["DDDD", "\\d{3}"],     // Day of year
		["DDD", "\\d{1,3}"],
		["DD", "\\d{2}"],
		["Do", "\\d{1,2}(?:st|nd|rd|th)"],
		["D", "\\d{1,2}"],
		["dddd", "[^\\\\/]+"],  // Full day name
		["ddd", "[^\\\\/]+"],   // Abbreviated day name
		["dd", "[^\\\\/]+"],    // Min day name
		["d", "\\d"],
		["Wo", "\\d{1,2}(?:st|nd|rd|th)"],
		["WW", "\\d{2}"],
		["W", "\\d{1,2}"],
		["ww", "\\d{2}"],
		["w", "\\d{1,2}"],
		["gggg", "\\d{4}"],
		["gg", "\\d{2}"],
		["GGGG", "\\d{4}"],
		["GG", "\\d{2}"],
	];

	// Phase 0: extract moment.js [...] bracket escapes as literal text
	// e.g. "[5. Periodic Notes]" → literal "5. Periodic Notes"
	let work = pattern;
	const literals: string[] = [];
	work = work.replace(/\[([^\]]*)\]/g, (_match, inner: string) => {
		const id = literals.length;
		literals.push(inner);
		return `\x01${id}\x01`;
	});

	// Phase 1: replace moment tokens with unique placeholders
	const replacements: { placeholder: string; regex: string }[] = [];
	let idx = 0;

	for (const [token, regex] of tokenMap) {
		while (work.includes(token)) {
			const placeholder = `\x00${idx++}\x00`;
			work = work.replace(token, placeholder);
			replacements.push({ placeholder, regex });
		}
	}

	// Phase 2: escape remaining literal characters for regex
	work = work.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	// Phase 3: restore bracket-escape placeholders → regex-escaped literal text
	for (let i = 0; i < literals.length; i++) {
		const escaped = literals[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		work = work.replace(`\x01${i}\x01`, escaped);
	}

	// Phase 4: restore token placeholders → regex patterns
	for (const { placeholder, regex } of replacements) {
		work = work.replace(placeholder, regex);
	}

	// Match the full path with .md extension
	return new RegExp("^" + work + "\\.md$");
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
		// Create new file — use template if configured
		let baseContent = "";
		if (settings.dailyNoteTemplatePath) {
			baseContent = await readTemplate(vault, settings.dailyNoteTemplatePath);
		}

		const serialized = items.map(serializeTimelineItem).join("\n");

		let content: string;
		if (baseContent && baseContent.includes(settings.timelineHeading.trim())) {
			// Template already contains the heading — insert items under it
			content = updateTimelineSection(baseContent, settings.timelineHeading, items);
		} else if (baseContent) {
			// Template exists but has no timeline heading — append it
			const suffix = baseContent.endsWith("\n") ? "" : "\n";
			content = baseContent + suffix + "\n" + settings.timelineHeading + "\n" + serialized + "\n";
		} else {
			// No template — heading + items only
			content = `${settings.timelineHeading}\n${serialized}\n`;
		}

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
 * Read a template file content as-is (no token replacement).
 * Template plugins (Templater etc.) handle their own processing.
 */
async function readTemplate(
	vault: Vault,
	templatePath: string
): Promise<string> {
	let path = templatePath.trim();
	if (!path.endsWith(".md")) path += ".md";
	path = normalizePath(path);

	const file = vault.getAbstractFileByPath(path);
	if (!file || !(file instanceof TFile)) return "";

	return vault.read(file);
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

// ── Review I/O ──

/**
 * Read review text from a daily note for a given date.
 */
export async function getDailyReviewContent(
	vault: Vault,
	date: Moment,
	settings: WeekFlowSettings
): Promise<string> {
	const path = resolveDailyNotePath(settings.dailyNotePath, date);
	const file = vault.getAbstractFileByPath(path);
	if (!file || !("extension" in file)) return "";

	const content = await vault.read(file as any);
	return parseReviewContent(content, settings.reviewHeading);
}

/**
 * Save review text to a daily note for a given date.
 * If file doesn't exist, creates it. If heading doesn't exist, appends it.
 */
export async function saveDailyReviewContent(
	vault: Vault,
	date: Moment,
	settings: WeekFlowSettings,
	reviewText: string
): Promise<void> {
	const path = resolveDailyNotePath(settings.dailyNotePath, date);
	const file = vault.getAbstractFileByPath(path);

	if (file && "extension" in file) {
		const content = await vault.read(file as any);
		const updated = updateReviewSection(
			content,
			settings.reviewHeading,
			reviewText,
			settings.timelineHeading
		);
		await vault.modify(file as any, updated);
	} else {
		// Create new file — use template if configured
		let baseContent = "";
		if (settings.dailyNoteTemplatePath) {
			baseContent = await readTemplate(vault, settings.dailyNoteTemplatePath);
		}

		let content: string;
		if (baseContent && baseContent.includes(settings.reviewHeading.trim())) {
			content = updateReviewSection(baseContent, settings.reviewHeading, reviewText, settings.timelineHeading);
		} else if (baseContent) {
			// Template exists but no review heading — insert after timeline if possible
			content = updateReviewSection(baseContent, settings.reviewHeading, reviewText, settings.timelineHeading);
		} else {
			content = `${settings.reviewHeading}\n${reviewText}\n`;
		}

		const dir = path.substring(0, path.lastIndexOf("/"));
		if (dir) {
			await ensureFolderExists(vault, dir);
		}
		await vault.create(path, content);
	}
}

/**
 * Load review data for an entire week.
 * Returns a Map keyed by date string (YYYY-MM-DD) → review text.
 */
export async function loadWeekReviewData(
	vault: Vault,
	dates: Moment[],
	settings: WeekFlowSettings
): Promise<Map<string, string>> {
	const reviewData = new Map<string, string>();
	const promises = dates.map(async (date) => {
		const text = await getDailyReviewContent(vault, date, settings);
		const dateKey = date.format("YYYY-MM-DD");
		reviewData.set(dateKey, text);
	});
	await Promise.all(promises);
	return reviewData;
}

// ── Inbox I/O ──

export interface InboxCheckboxItem extends CheckboxItem {
	sourcePath: string; // file path where this item was found
}

/**
 * Check if an inbox source path is a folder.
 */
function isFolder(vault: Vault, path: string): boolean {
	const abstract = vault.getAbstractFileByPath(normalizePath(path));
	return abstract instanceof TFolder;
}

/**
 * Collect all .md files under a folder recursively.
 */
function collectMarkdownFiles(vault: Vault, folderPath: string, exclude?: RegExp): TFile[] {
	const folder = vault.getAbstractFileByPath(normalizePath(folderPath));
	if (!folder || !(folder instanceof TFolder)) return [];

	const files: TFile[] = [];
	const recurse = (f: TFolder) => {
		for (const child of f.children) {
			if (child instanceof TFile && child.extension === "md") {
				if (exclude && exclude.test(child.path)) continue;
				files.push(child);
			} else if (child instanceof TFolder) {
				recurse(child);
			}
		}
	};
	recurse(folder);
	return files;
}

/**
 * Get all file paths that inbox sources reference (for file-change watching).
 */
export function getInboxWatchPaths(vault: Vault, sources: InboxSource[], dailyNotePath: string): string[] {
	const exclude = buildDailyNotePathRegex(dailyNotePath);
	const paths: string[] = [];
	for (const src of sources) {
		const p = normalizePath(src.path);
		if (isFolder(vault, p)) {
			for (const f of collectMarkdownFiles(vault, p, exclude)) {
				paths.push(f.path);
			}
		} else {
			// Ensure .md extension
			const filePath = p.endsWith(".md") ? p : p + ".md";
			paths.push(filePath);
		}
	}
	return paths;
}

/**
 * Read unchecked checkbox items from all inbox sources.
 * Returns items annotated with their source file path.
 */
export async function getInboxItems(
	vault: Vault,
	settings: WeekFlowSettings
): Promise<InboxCheckboxItem[]> {
	const exclude = buildDailyNotePathRegex(settings.dailyNotePath);
	const allItems: InboxCheckboxItem[] = [];

	for (const source of settings.inboxSources) {
		const p = normalizePath(source.path);

		if (isFolder(vault, p)) {
			// Folder source: read all .md files recursively
			const files = collectMarkdownFiles(vault, p, exclude);
			for (const file of files) {
				const content = await vault.read(file);
				const items = parseCheckboxItems(content, ""); // No heading: parse entire file
				for (const item of items) {
					allItems.push({ ...item, sourcePath: file.path });
				}
			}
		} else {
			// Note source
			const filePath = p.endsWith(".md") ? p : p + ".md";
			const file = vault.getAbstractFileByPath(filePath);
			if (!file || !(file instanceof TFile)) continue;

			const content = await vault.read(file);
			const items = parseCheckboxItems(content, source.heading);
			for (const item of items) {
				allItems.push({ ...item, sourcePath: file.path });
			}
		}
	}

	return allItems;
}

/**
 * Find the first note source (non-folder) from inbox sources.
 * Returns null if no note source exists.
 */
export function getPrimaryInboxNoteSource(vault: Vault, sources: InboxSource[]): InboxSource | null {
	for (const src of sources) {
		const p = normalizePath(src.path);
		if (!isFolder(vault, p)) {
			return src;
		}
	}
	return null;
}

/**
 * Add a checkbox line to the priority-1 note source in inbox.
 * Creates the note and/or heading if they don't exist.
 * Skips folder sources (read-only).
 */
export async function addToInbox(
	vault: Vault,
	settings: WeekFlowSettings,
	line: string
): Promise<void> {
	const primary = getPrimaryInboxNoteSource(vault, settings.inboxSources);
	if (!primary) return; // No writable note source

	const p = normalizePath(primary.path);
	const filePath = p.endsWith(".md") ? p : p + ".md";
	const file = vault.getAbstractFileByPath(filePath);

	if (file && file instanceof TFile) {
		const content = await vault.read(file);
		const heading = primary.heading;

		if (!heading.trim()) {
			// No heading: append to end of file
			const suffix = content.endsWith("\n") ? "" : "\n";
			const updated = content + suffix + line + "\n";
			await vault.modify(file, updated);
		} else {
			const headingLevel = (heading.match(/^#+/) || [""])[0].length;
			const lines = content.split("\n");

			let insertIdx = -1;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].trim() === heading.trim()) {
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
				await vault.modify(file, updated);
			} else {
				lines.splice(insertIdx, 0, line);
				await vault.modify(file, lines.join("\n"));
			}
		}
	} else {
		// Create new file
		const dir = filePath.substring(0, filePath.lastIndexOf("/"));
		if (dir) {
			await ensureFolderExists(vault, dir);
		}
		const heading = primary.heading;
		const content = heading.trim()
			? `${heading}\n${line}\n`
			: `${line}\n`;
		await vault.create(filePath, content);
	}
}

/**
 * Remove a checkbox item from a specific inbox file by line number.
 */
export async function removeFromInboxFile(
	vault: Vault,
	filePath: string,
	lineNumber: number
): Promise<void> {
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || !(file instanceof TFile)) return;

	const content = await vault.read(file);
	const lines = content.split("\n");
	if (lineNumber >= 0 && lineNumber < lines.length) {
		lines.splice(lineNumber, 1);
		await vault.modify(file, lines.join("\n"));
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
		const rawFmTags = cache.frontmatter?.tags;
		const fmTags: string[] = Array.isArray(rawFmTags)
			? rawFmTags.filter((t: unknown): t is string => typeof t === "string").map((t) => t.replace(/^#/, ""))
			: typeof rawFmTags === "string"
				? [rawFmTags.replace(/^#/, "")]
				: [];
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
