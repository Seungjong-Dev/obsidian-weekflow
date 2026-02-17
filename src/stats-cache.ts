import { type Vault, TFile, normalizePath, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { TimelineItem, WeekFlowSettings } from "./types";
import { parseTimelineItems } from "./parser";

interface CachedDailyData {
	mtime: number;
	items: TimelineItem[];
}

export class StatsCache {
	private cache: Map<string, CachedDailyData> = new Map();

	/**
	 * Load timeline items for a date range, using cache when possible.
	 * Checks file mtime to determine cache validity.
	 */
	async loadRange(
		vault: Vault,
		dates: Moment[],
		settings: WeekFlowSettings
	): Promise<TimelineItem[]> {
		const allItems: TimelineItem[] = [];

		const promises = dates.map(async (date) => {
			const dateKey = date.format("YYYY-MM-DD");
			const path = normalizePath(date.format(settings.dailyNotePath) + ".md");
			const file = vault.getAbstractFileByPath(path);

			if (!file || !(file instanceof TFile)) {
				// No file — clear cache and return empty
				this.cache.delete(dateKey);
				return [];
			}

			const mtime = file.stat.mtime;
			const cached = this.cache.get(dateKey);

			if (cached && cached.mtime === mtime) {
				return cached.items;
			}

			// Cache miss — parse fresh
			const content = await vault.read(file);
			const result = parseTimelineItems(content, settings.timelineHeading);
			this.cache.set(dateKey, { mtime, items: result.items });
			return result.items;
		});

		const results = await Promise.all(promises);
		for (const items of results) {
			allItems.push(...items);
		}

		return allItems;
	}

	/** Invalidate cache for a specific date. */
	invalidate(dateKey: string): void {
		this.cache.delete(dateKey);
	}

	/** Clear entire cache. */
	clear(): void {
		this.cache.clear();
	}
}
