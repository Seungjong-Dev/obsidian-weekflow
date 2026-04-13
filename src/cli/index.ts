/**
 * WeekFlow CLI — command registration.
 *
 * Registers all CLI handlers on the plugin instance using Obsidian's
 * native registerCliHandler API (available since 1.12.2).
 */

import type WeekFlowPlugin from "../main";
import {
	weekflowFlags, weekflowHandler,
	todayFlags, todayHandler,
	digestFlags, digestHandler,
	inboxFlags, inboxHandler,
	statsFlags, statsHandler,
	projectsFlags, projectsHandler,
	reviewReadFlags, reviewReadHandler,
	weeklyReviewReadFlags, weeklyReviewReadHandler,
	logReadFlags, logReadHandler,
	settingsFlags, settingsHandler,
} from "./handlers-read";
import {
	addFlags, addHandler,
	completeFlags, completeHandler,
	deferFlags, deferHandler,
	deleteFlags, deleteHandler,
	inboxAddFlags, inboxAddHandler,
	inboxRemoveFlags, inboxRemoveHandler,
	reviewWriteFlags, reviewWriteHandler,
	weeklyReviewWriteFlags, weeklyReviewWriteHandler,
	logAddFlags, logAddHandler,
	logDeleteFlags, logDeleteHandler,
} from "./handlers-write";

/**
 * Register all WeekFlow CLI commands.
 * Returns true if registration succeeded, false if the API is not available.
 */
export function registerAllCliHandlers(plugin: WeekFlowPlugin): boolean {
	if (typeof plugin.registerCliHandler !== "function") {
		return false;
	}

	const ctx = {
		get app() { return plugin.app; },
		get settings() { return plugin.settings; },
	};

	// Read commands
	plugin.registerCliHandler(
		"weekflow",
		"Show this week's digest (timeline + stats + review)",
		weekflowFlags,
		weekflowHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:today",
		"Show today's timeline items",
		todayFlags,
		todayHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:digest",
		"Show digest for a custom date range",
		digestFlags,
		digestHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:inbox",
		"List all inbox items",
		inboxFlags,
		inboxHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:stats",
		"Show time statistics (category & project breakdown)",
		statsFlags,
		statsHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:projects",
		"List active projects and their tasks",
		projectsFlags,
		projectsHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:review",
		"Read review text for a date",
		reviewReadFlags,
		reviewReadHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:settings",
		"Show all plugin settings (weekStartDay, paths, categories, etc.)",
		settingsFlags,
		settingsHandler(ctx),
	);

	// Write commands
	plugin.registerCliHandler(
		"weekflow:add",
		"Add a timeline block to a date",
		addFlags,
		addHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:complete",
		"Mark a timeline block as completed (actual)",
		completeFlags,
		completeHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:defer",
		"Defer a plan block to another date",
		deferFlags,
		deferHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:delete",
		"Delete a timeline block",
		deleteFlags,
		deleteHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:inbox:add",
		"Add an item to inbox",
		inboxAddFlags,
		inboxAddHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:inbox:remove",
		"Remove an item from inbox",
		inboxRemoveFlags,
		inboxRemoveHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:review:write",
		"Save review text for a date",
		reviewWriteFlags,
		reviewWriteHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:weekly-review",
		"Read review text from the weekly note",
		weeklyReviewReadFlags,
		weeklyReviewReadHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:weekly-review:write",
		"Save review text to the weekly note",
		weeklyReviewWriteFlags,
		weeklyReviewWriteHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:log",
		"List log entries for a date",
		logReadFlags,
		logReadHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:log:add",
		"Append a timestamped log entry",
		logAddFlags,
		logAddHandler(ctx),
	);

	plugin.registerCliHandler(
		"weekflow:log:delete",
		"Delete log entries by index",
		logDeleteFlags,
		logDeleteHandler(ctx),
	);

	return true;
}
