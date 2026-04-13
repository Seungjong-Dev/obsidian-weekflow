/**
 * WeekFlow CLI — Read (query) handlers.
 *
 * All handlers are (params: CliData) => Promise<string>.
 * They return JSON via the response helpers.
 */

import { moment } from "obsidian";
import type { App } from "obsidian";
import type { CliData, CliFlags } from "obsidian";
import type { WeekFlowSettings } from "../types";
import {
	getWeekDates,
	loadWeekData,
	loadWeekReviewData,
	getDailyNoteItems,
	getDailyReviewContent,
	getDailyLogItems,
	getInboxItems,
	getActiveProjects,
	getProjectTasks,
} from "../daily-note";
import { getWeeklyReviewContent } from "../weekly-note";
import { buildDigest, toDigestItem, toDigestDaySummary } from "../digest";
import type { LogItem } from "../types";
import { calculateCategoryStats, calculateProjectStats, calculatePlanActualSummary } from "../statistics";
import { ok, err, validateRequired } from "./response";

type Ctx = { app: App; settings: WeekFlowSettings };

// ── weekflow (default) — this week's digest ──

export const weekflowFlags: CliFlags = {
	from: { value: "<YYYY-MM-DD>", description: "Start date (default: this week's start)" },
	to: { value: "<YYYY-MM-DD>", description: "End date (default: this week's end)" },
};

export function weekflowHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow";
		try {
			const dates = resolveDateRange(params, ctx.settings);
			const [{ weekData }, reviewData] = await Promise.all([
				loadWeekData(ctx.app.vault, dates, ctx.settings),
				loadWeekReviewData(ctx.app.vault, dates, ctx.settings),
			]);
			return ok(CMD, buildDigest(dates, weekData, reviewData, ctx.settings));
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:today ──

export const todayFlags: CliFlags | null = null;

export function todayHandler(ctx: Ctx) {
	return async (_params: CliData): Promise<string> => {
		const CMD = "weekflow:today";
		try {
			const date = moment();
			const { items } = await getDailyNoteItems(ctx.app.vault, date, ctx.settings);
			const review = await getDailyReviewContent(ctx.app.vault, date, ctx.settings);
			return ok(CMD, {
				date: date.format("YYYY-MM-DD"),
				weekday: date.format("ddd"),
				items: items.map((item, idx) => toDigestItem(item, idx)),
				review: review || null,
				summary: toDigestDaySummary(items),
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:digest — arbitrary date range ──

export const digestFlags: CliFlags = {
	from: { value: "<YYYY-MM-DD>", description: "Start date", required: true },
	to: { value: "<YYYY-MM-DD>", description: "End date", required: true },
	"include-review": { description: "Include review text (default: true)" },
};

export function digestHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:digest";
		const missing = validateRequired(params, ["from", "to"]);
		if (missing) return err(CMD, missing);

		try {
			const dates = buildDateArray(params.from, params.to);
			const [{ weekData }, reviewData] = await Promise.all([
				loadWeekData(ctx.app.vault, dates, ctx.settings),
				loadWeekReviewData(ctx.app.vault, dates, ctx.settings),
			]);
			const includeReview = params["include-review"] !== "false";
			const digest = buildDigest(dates, weekData, includeReview ? reviewData : new Map(), ctx.settings);
			return ok(CMD, digest);
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:inbox ──

export const inboxFlags: CliFlags | null = null;

export function inboxHandler(ctx: Ctx) {
	return async (_params: CliData): Promise<string> => {
		const CMD = "weekflow:inbox";
		try {
			const items = await getInboxItems(ctx.app.vault, ctx.settings);
			return ok(CMD, {
				items: items.map((item, idx) => ({
					index: idx,
					content: item.content,
					tags: item.tags,
					rawSuffix: item.rawSuffix,
					sourcePath: item.sourcePath,
					lineNumber: item.lineNumber,
				})),
				count: items.length,
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:stats ──

export const statsFlags: CliFlags = {
	from: { value: "<YYYY-MM-DD>", description: "Start date (default: this week's start)" },
	to: { value: "<YYYY-MM-DD>", description: "End date (default: this week's end)" },
};

export function statsHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:stats";
		try {
			const dates = resolveDateRange(params, ctx.settings);
			const { weekData } = await loadWeekData(ctx.app.vault, dates, ctx.settings);

			const allItems = dates.flatMap((d) => weekData.get(d.format("YYYY-MM-DD")) || []);
			const categoryStats = calculateCategoryStats(allItems, ctx.settings.categories);
			const projectStats = calculateProjectStats(allItems);
			const summary = calculatePlanActualSummary(allItems);

			return ok(CMD, {
				period: {
					start: dates[0].format("YYYY-MM-DD"),
					end: dates[dates.length - 1].format("YYYY-MM-DD"),
				},
				summary,
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
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:projects ──

export const projectsFlags: CliFlags | null = null;

export function projectsHandler(ctx: Ctx) {
	return async (_params: CliData): Promise<string> => {
		const CMD = "weekflow:projects";
		try {
			const projects = getActiveProjects(ctx.app, ctx.settings);
			const result = await Promise.all(
				projects.map(async (p) => {
					const tasks = await getProjectTasks(ctx.app.vault, p.path, ctx.settings.projectTasksHeading);
					return {
						path: p.path,
						title: p.title,
						tasks: tasks.map((t, idx) => ({
							index: idx,
							content: t.content,
							tags: t.tags,
						})),
					};
				})
			);
			return ok(CMD, { projects: result });
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:review (read) ──

export const reviewReadFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Date to read review from (default: today)" },
};

export function reviewReadHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:review";
		try {
			const date = params.date ? moment(params.date, "YYYY-MM-DD") : moment();
			if (!date.isValid()) return err(CMD, `Invalid date: ${params.date}`);
			const review = await getDailyReviewContent(ctx.app.vault, date, ctx.settings);
			return ok(CMD, {
				date: date.format("YYYY-MM-DD"),
				review: review || null,
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:log (read) ──

export const logReadFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Date to read logs from (default: today)" },
};

export function logReadHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:log";
		try {
			const date = params.date ? moment(params.date, "YYYY-MM-DD") : moment();
			if (!date.isValid()) return err(CMD, `Invalid date: ${params.date}`);

			const logs = await getDailyLogItems(ctx.app.vault, date, ctx.settings);
			const sorted = [...logs].sort((a, b) => a.timeMinutes - b.timeMinutes);
			return ok(CMD, {
				date: date.format("YYYY-MM-DD"),
				items: sorted.map((log, idx) => toDigestLog(log, idx, ctx.settings.logTimestampFormat)),
				count: sorted.length,
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

/**
 * Serialize a LogItem for CLI output. Exposes both the formatted timestamp
 * (human/agent-readable, using the configured moment format) and the raw
 * minutes-since-midnight (for downstream sorting/math).
 */
export function toDigestLog(log: LogItem, index: number, format: string) {
	const time = moment()
		.startOf("day")
		.add(log.timeMinutes, "minutes")
		.format(format || "HH:mm");
	return {
		index,
		time,
		timeMinutes: log.timeMinutes,
		content: log.content,
	};
}

// ── weekflow:weekly-review (read) ──

export const weeklyReviewReadFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Any date within the target week (default: today)" },
};

export function weeklyReviewReadHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:weekly-review";
		try {
			const date = params.date ? moment(params.date, "YYYY-MM-DD") : moment();
			if (!date.isValid()) return err(CMD, `Invalid date: ${params.date}`);
			const review = await getWeeklyReviewContent(ctx.app.vault, date, ctx.settings);
			return ok(CMD, {
				week: date.format("GGGG-[W]WW"),
				date: date.format("YYYY-MM-DD"),
				review: review || null,
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:settings — expose plugin settings for external agents ──

export const settingsFlags: CliFlags | null = null;

export function settingsHandler(ctx: Ctx) {
	return async (_params: CliData): Promise<string> => {
		const CMD = "weekflow:settings";
		return ok(CMD, ctx.settings);
	};
}

// ── Helpers ──

function resolveDateRange(params: CliData, settings: WeekFlowSettings) {
	if (params.from && params.to) {
		return buildDateArray(params.from, params.to);
	}
	return getWeekDates(moment(), settings.weekStartDay);
}

function buildDateArray(from: string, to: string) {
	const start = moment(from, "YYYY-MM-DD");
	const end = moment(to, "YYYY-MM-DD");
	if (!start.isValid()) throw new Error(`Invalid from date: ${from}`);
	if (!end.isValid()) throw new Error(`Invalid to date: ${to}`);
	if (end.isBefore(start)) throw new Error(`'to' must be after 'from'`);

	const dates = [];
	const cursor = start.clone();
	while (cursor.isSameOrBefore(end, "day")) {
		dates.push(cursor.clone());
		cursor.add(1, "day");
	}
	return dates;
}
