/**
 * WeekFlow CLI — Write (mutation) handlers.
 *
 * All write operations are headless: vault + settings only, no UI context.
 * Items are identified by date + index (array position from parse order).
 */

import { moment } from "obsidian";
import type { App } from "obsidian";
import type { CliData, CliFlags } from "obsidian";
import type { WeekFlowSettings, TimelineItem } from "../types";
import {
	getDailyNoteItems,
	saveDailyNoteItems,
	saveDailyReviewContent,
	addToInbox,
	getInboxItems,
	removeFromInboxFile,
} from "../daily-note";
import { generateItemId, parseTime, serializeCheckboxItem } from "../parser";
import { toDigestItem } from "../digest";
import { ok, err, validateRequired } from "./response";

type Ctx = { app: App; settings: WeekFlowSettings };

/** Parse comma-separated indices, validate, and return sorted descending. */
function parseIndices(raw: string, maxLen: number): { indices: number[] } | { error: string } {
	const indices = raw.split(",").map((s) => parseInt(s.trim(), 10));
	if (indices.some(isNaN)) return { error: `Invalid index value: ${raw}` };
	for (const idx of indices) {
		if (idx < 0 || idx >= maxLen) {
			return { error: `Index ${idx} out of range (0-${maxLen - 1})` };
		}
	}
	const unique = [...new Set(indices)];
	unique.sort((a, b) => b - a); // descending — process from end to avoid shift
	return { indices: unique };
}

// ── weekflow:add — create a timeline block ──

export const addFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Target date", required: true },
	start: { value: "<HH:MM>", description: "Start time", required: true },
	end: { value: "<HH:MM>", description: "End time", required: true },
	content: { value: "<text>", description: "Block content", required: true },
	tags: { value: "<tag1,tag2>", description: "Comma-separated tags" },
	type: { value: "<plan|actual>", description: "Block type (default: plan)" },
};

export function addHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:add";
		const missing = validateRequired(params, ["date", "start", "end", "content"]);
		if (missing) return err(CMD, missing);

		try {
			const date = moment(params.date, "YYYY-MM-DD");
			if (!date.isValid()) return err(CMD, `Invalid date: ${params.date}`);

			const startMin = parseTime(params.start);
			const endMin = parseTime(params.end);
			if (endMin <= startMin) return err(CMD, "End time must be after start time");

			const tags = params.tags ? params.tags.split(",").map((t) => t.trim()) : [];
			const checkbox = params.type === "actual" ? "actual" as const : "plan" as const;

			const newItem: TimelineItem = {
				id: generateItemId(),
				checkbox,
				planTime: { start: startMin, end: endMin },
				content: params.content,
				tags,
				rawSuffix: "",
			};

			const { items } = await getDailyNoteItems(ctx.app.vault, date, ctx.settings);
			items.push(newItem);
			await saveDailyNoteItems(ctx.app.vault, date, ctx.settings, items);

			return ok(CMD, {
				date: params.date,
				item: toDigestItem(newItem, items.length - 1),
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:complete — mark a block as actual ──

export const completeFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Target date", required: true },
	index: { value: "<N|N,N,...>", description: "Item index(es), comma-separated for batch", required: true },
	"actual-start": { value: "<HH:MM>", description: "Actual start time (default: same as plan)" },
	"actual-end": { value: "<HH:MM>", description: "Actual end time (default: same as plan)" },
};

export function completeHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:complete";
		const missing = validateRequired(params, ["date", "index"]);
		if (missing) return err(CMD, missing);

		try {
			const date = moment(params.date, "YYYY-MM-DD");
			if (!date.isValid()) return err(CMD, `Invalid date: ${params.date}`);

			const { items } = await getDailyNoteItems(ctx.app.vault, date, ctx.settings);

			const parsed = parseIndices(params.index, items.length);
			if ("error" in parsed) return err(CMD, parsed.error);

			// actual-start/end only applies when completing a single item
			if (parsed.indices.length > 1 && (params["actual-start"] || params["actual-end"])) {
				return err(CMD, "actual-start/actual-end can only be used with a single index");
			}

			const completed = [];
			for (const idx of parsed.indices) {
				const item = items[idx];
				if (item.checkbox === "actual") {
					return err(CMD, `Item at index ${idx} is already completed`);
				}
				item.checkbox = "actual";

				if (params["actual-start"] || params["actual-end"]) {
					const actStart = params["actual-start"] ? parseTime(params["actual-start"]) : item.planTime.start;
					const actEnd = params["actual-end"] ? parseTime(params["actual-end"]) : item.planTime.end;
					if (actEnd <= actStart) return err(CMD, "Actual end time must be after actual start time");
					item.actualTime = { start: actStart, end: actEnd };
				}
				completed.push(toDigestItem(item, idx));
			}

			await saveDailyNoteItems(ctx.app.vault, date, ctx.settings, items);

			const data = completed.length === 1
				? { date: params.date, item: completed[0] }
				: { date: params.date, items: completed };
			return ok(CMD, data);
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:defer — move a block to another day ──

export const deferFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Source date", required: true },
	index: { value: "<N|N,N,...>", description: "Item index(es), comma-separated for batch", required: true },
	to: { value: "<YYYY-MM-DD>", description: "Target date", required: true },
};

export function deferHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:defer";
		const missing = validateRequired(params, ["date", "index", "to"]);
		if (missing) return err(CMD, missing);

		try {
			const fromDate = moment(params.date, "YYYY-MM-DD");
			const toDate = moment(params.to, "YYYY-MM-DD");
			if (!fromDate.isValid()) return err(CMD, `Invalid date: ${params.date}`);
			if (!toDate.isValid()) return err(CMD, `Invalid to date: ${params.to}`);

			const { items: fromItems } = await getDailyNoteItems(ctx.app.vault, fromDate, ctx.settings);

			const parsed = parseIndices(params.index, fromItems.length);
			if ("error" in parsed) return err(CMD, parsed.error);

			// Validate all items are plan before mutating
			for (const idx of parsed.indices) {
				if (fromItems[idx].checkbox !== "plan") {
					return err(CMD, `Only plan items can be deferred (index ${idx} is '${fromItems[idx].checkbox}')`);
				}
			}

			// Mark originals as deferred (indices are descending, safe to mutate)
			const deferred = [];
			for (const idx of parsed.indices) {
				fromItems[idx].checkbox = "deferred";
				deferred.push(idx);
			}
			await saveDailyNoteItems(ctx.app.vault, fromDate, ctx.settings, fromItems);

			// Create new plan items on target date
			const { items: toItems } = await getDailyNoteItems(ctx.app.vault, toDate, ctx.settings);
			const created = [];
			// Add in ascending order so target indices are predictable
			for (const idx of [...parsed.indices].reverse()) {
				const item = fromItems[idx];
				const newItem: TimelineItem = {
					id: generateItemId(),
					checkbox: "plan",
					planTime: { ...item.planTime },
					content: item.content,
					tags: [...item.tags],
					rawSuffix: item.rawSuffix,
				};
				toItems.push(newItem);
				created.push(toDigestItem(newItem, toItems.length - 1));
			}
			await saveDailyNoteItems(ctx.app.vault, toDate, ctx.settings, toItems);

			if (parsed.indices.length === 1) {
				return ok(CMD, {
					from: { date: params.date, index: parsed.indices[0], status: "deferred" },
					to: { date: params.to, item: created[0] },
				});
			}
			return ok(CMD, {
				from: { date: params.date, indices: deferred.sort((a, b) => a - b), status: "deferred" },
				to: { date: params.to, items: created },
			});
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:delete — remove a block ──

export const deleteFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Target date", required: true },
	index: { value: "<N|N,N,...>", description: "Item index(es), comma-separated for batch", required: true },
};

export function deleteHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:delete";
		const missing = validateRequired(params, ["date", "index"]);
		if (missing) return err(CMD, missing);

		try {
			const date = moment(params.date, "YYYY-MM-DD");
			if (!date.isValid()) return err(CMD, `Invalid date: ${params.date}`);

			const { items } = await getDailyNoteItems(ctx.app.vault, date, ctx.settings);

			const parsed = parseIndices(params.index, items.length);
			if ("error" in parsed) return err(CMD, parsed.error);

			// Splice in descending order so indices stay valid
			const removedList = [];
			for (const idx of parsed.indices) {
				const removed = items.splice(idx, 1)[0];
				removedList.push(toDigestItem(removed, idx));
			}
			await saveDailyNoteItems(ctx.app.vault, date, ctx.settings, items);

			if (removedList.length === 1) {
				return ok(CMD, { date: params.date, removed: removedList[0] });
			}
			// Return in ascending index order for readability
			removedList.reverse();
			return ok(CMD, { date: params.date, removed: removedList });
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:inbox:add ──

export const inboxAddFlags: CliFlags = {
	content: { value: "<text>", description: "Item text", required: true },
	tags: { value: "<tag1,tag2>", description: "Comma-separated tags" },
};

export function inboxAddHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:inbox:add";
		const missing = validateRequired(params, ["content"]);
		if (missing) return err(CMD, missing);

		try {
			const tags = params.tags ? params.tags.split(",").map((t) => t.trim()) : [];
			const line = serializeCheckboxItem(params.content, tags, "");
			await addToInbox(ctx.app.vault, ctx.settings, line);
			return ok(CMD, { content: params.content, tags });
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:inbox:remove ──

export const inboxRemoveFlags: CliFlags = {
	index: { value: "<N|N,N,...>", description: "Item index(es), comma-separated for batch", required: true },
};

export function inboxRemoveHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:inbox:remove";
		const missing = validateRequired(params, ["index"]);
		if (missing) return err(CMD, missing);

		try {
			const items = await getInboxItems(ctx.app.vault, ctx.settings);

			const parsed = parseIndices(params.index, items.length);
			if ("error" in parsed) return err(CMD, parsed.error);

			// Remove in descending order so line numbers stay valid
			const removedList = [];
			for (const idx of parsed.indices) {
				const item = items[idx];
				await removeFromInboxFile(ctx.app.vault, item.sourcePath, item.lineNumber);
				removedList.push({ content: item.content, tags: item.tags });
			}

			if (removedList.length === 1) {
				return ok(CMD, { removed: removedList[0] });
			}
			removedList.reverse();
			return ok(CMD, { removed: removedList });
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}

// ── weekflow:review (write) ──

export const reviewWriteFlags: CliFlags = {
	date: { value: "<YYYY-MM-DD>", description: "Target date", required: true },
	text: { value: "<text>", description: "Review text content", required: true },
};

export function reviewWriteHandler(ctx: Ctx) {
	return async (params: CliData): Promise<string> => {
		const CMD = "weekflow:review:write";
		const missing = validateRequired(params, ["date", "text"]);
		if (missing) return err(CMD, missing);

		try {
			const date = moment(params.date, "YYYY-MM-DD");
			if (!date.isValid()) return err(CMD, `Invalid date: ${params.date}`);

			await saveDailyReviewContent(ctx.app.vault, date, ctx.settings, params.text);
			return ok(CMD, { date: params.date, saved: true });
		} catch (e) {
			return err(CMD, String(e));
		}
	};
}
