import { type Vault, normalizePath, TFile } from "obsidian";
type Moment = import("moment").Moment;
import type { WeekFlowSettings } from "./types";
import { parseReviewContent, updateReviewSection } from "./parser";
import { ensureFolderExists, readTemplate } from "./daily-note";

/**
 * Resolve a weekly note path from a moment.js pattern + date.
 * Any date within the same ISO week resolves to the same path
 * because moment.js week tokens (ww, gggg, etc.) are week-stable.
 */
export function resolveWeeklyNotePath(
	pattern: string,
	date: Moment
): string {
	return normalizePath(date.format(pattern) + ".md");
}

/**
 * Read review text from a weekly note for a given date's week.
 */
export async function getWeeklyReviewContent(
	vault: Vault,
	date: Moment,
	settings: WeekFlowSettings
): Promise<string> {
	const path = resolveWeeklyNotePath(settings.weeklyNotePath, date);
	const file = vault.getAbstractFileByPath(path);
	if (!file || !(file instanceof TFile)) return "";

	const content = await vault.read(file);
	return parseReviewContent(content, settings.reviewHeading);
}

/**
 * Save review text to a weekly note for a given date's week.
 * If file doesn't exist, creates it. If heading doesn't exist, appends it.
 */
export async function saveWeeklyReviewContent(
	vault: Vault,
	date: Moment,
	settings: WeekFlowSettings,
	reviewText: string
): Promise<void> {
	const path = resolveWeeklyNotePath(settings.weeklyNotePath, date);
	const file = vault.getAbstractFileByPath(path);

	if (file && file instanceof TFile) {
		const content = await vault.read(file);
		const updated = updateReviewSection(
			content,
			settings.reviewHeading,
			reviewText,
			settings.timelineHeading
		);
		await vault.modify(file, updated);
	} else {
		let baseContent = "";
		if (settings.weeklyNoteTemplatePath) {
			baseContent = await readTemplate(vault, settings.weeklyNoteTemplatePath);
		}

		let content: string;
		if (baseContent) {
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
