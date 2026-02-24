import { requestUrl } from "obsidian";
import ICAL from "ical.js";
import type { CalendarSource, CalendarEvent } from "./types";

const MAX_EXPANSIONS = 3650; // ~10 years of daily events

// In-memory cache
const cache = new Map<string, { text: string; fetchedAt: number }>();

async function fetchICS(url: string, cacheDurationMin: number): Promise<string | null> {
	const now = Date.now();
	const cached = cache.get(url);

	if (cached && cacheDurationMin > 0) {
		const age = (now - cached.fetchedAt) / 60000;
		if (age < cacheDurationMin) {
			return cached.text;
		}
	}

	try {
		const response = await requestUrl({ url });
		const text = response.text;
		cache.set(url, { text, fetchedAt: now });
		return text;
	} catch (e) {
		// Stale cache fallback: return expired cache if available
		if (cached) {
			return cached.text;
		}
		return null;
	}
}

function parseICSEvents(
	icsText: string,
	rangeStart: Date,
	rangeEnd: Date,
	source: CalendarSource
): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	const comp = ICAL.Component.fromString(icsText);

	// Register VTIMEZONE components so ical.js can resolve TZID references.
	// Without this, events with TZID may fail to convert or silently produce
	// incorrect times, causing them to be filtered out of the visible range.
	for (const vtz of comp.getAllSubcomponents("vtimezone")) {
		const tz = new ICAL.Timezone(vtz);
		ICAL.TimezoneService.register(tz.tzid, tz);
	}

	const vevents = comp.getAllSubcomponents("vevent");

	const rangeStartMs = rangeStart.getTime();
	const rangeEndMs = rangeEnd.getTime();

	for (const vevent of vevents) {
		// Skip recurrence exceptions — they are handled by parent event's
		// getOccurrenceDetails() which automatically substitutes modified data
		if (vevent.hasProperty('recurrence-id')) continue;

		try {
			const event = new ICAL.Event(vevent);
			const summary = event.summary || "(No title)";

			if (event.isRecurring()) {
				// Use event's own DTSTART to preserve recurrence pattern
				// alignment (e.g., bi-weekly INTERVAL=2 phase).
				const iter = event.iterator();
				let count = 0;
				let next = iter.next();

				while (next && !iter.complete && count < MAX_EXPANSIONS) {
					count++;

					const details = event.getOccurrenceDetails(next);
					const occStart = details.startDate.toJSDate();
					if (occStart.getTime() >= rangeEndMs) break;

					const occEnd = details.endDate.toJSDate();

					if (occEnd.getTime() <= rangeStartMs) {
						next = iter.next();
						continue;
					}

					if (details.startDate.isDate) {
						next = iter.next();
						continue; // Skip all-day events
					}

					const occSummary = details.item.summary || "(No title)";

					events.push({
						uid: event.uid + "_" + occStart.toISOString(),
						summary: occSummary,
						start: occStart,
						end: occEnd,
						allDay: false,
						sourceId: source.id,
						color: source.color,
					});

					next = iter.next();
				}
			} else {
				const start = event.startDate.toJSDate();
				const end = event.endDate.toJSDate();

				if (event.startDate.isDate) continue;
				if (end.getTime() <= rangeStartMs || start.getTime() >= rangeEndMs) continue;

				events.push({
					uid: event.uid,
					summary,
					start,
					end,
					allDay: false,
					sourceId: source.id,
					color: source.color,
				});
			}
		} catch (e) {
			// Skip individual event parse errors
			continue;
		}
	}

	return events;
}

export async function getCalendarEventsForWeek(
	sources: CalendarSource[],
	weekStart: Date,
	weekEnd: Date,
	cacheDurationMin: number
): Promise<{ events: CalendarEvent[]; errors: string[] }> {
	const enabledSources = sources.filter((s) => s.enabled && s.url);
	if (enabledSources.length === 0) {
		return { events: [], errors: [] };
	}

	const results = await Promise.allSettled(
		enabledSources.map(async (source) => {
			const icsText = await fetchICS(source.url, cacheDurationMin);
			if (!icsText) {
				throw new Error(`Failed to fetch: ${source.name}`);
			}
			return parseICSEvents(icsText, weekStart, weekEnd, source);
		})
	);

	const events: CalendarEvent[] = [];
	const errors: string[] = [];

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result.status === "fulfilled") {
			events.push(...result.value);
		} else {
			errors.push(enabledSources[i].name + ": " + result.reason?.message);
		}
	}

	return { events, errors };
}

export function clearCalendarCache(): void {
	cache.clear();
}
