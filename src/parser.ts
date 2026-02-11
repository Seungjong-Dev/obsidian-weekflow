import type { CheckboxState, ParseResult, ParseWarning, TimelineItem, TimeRange } from "./types";

let idCounter = 0;
export function generateItemId(): string {
	return `wf-${Date.now()}-${idCounter++}`;
}

/** Extract a block ID (^block-id) from the end of a line */
export function extractBlockId(line: string): string | undefined {
	const m = line.match(/\^([a-zA-Z0-9-]+)\s*$/);
	return m ? m[1] : undefined;
}

/** Generate a unique block ID for project task linking */
export function generateBlockId(): string {
	return `wf-${Date.now().toString(36)}`;
}

const TIMELINE_RE =
	/^- \[([ x>])\] (\d{2}:\d{2})-(\d{2}:\d{2})(?:\s*>\s*(\d{2}:\d{2})-(\d{2}:\d{2}))?\s+(.+)$/;

const TAG_RE = /#([^\s#]+)/g;

// Loose match: any line that starts like a checkbox item (for warning detection)
const CHECKBOX_LINE_RE = /^- \[.\]/;

// Tasks plugin emoji metadata patterns
const TASKS_META_RE =
	/(?:📅|⏳|🛫|✅|⏫|🔼|🔽|🔁|➕|🔄|⛔|🆔|🏷️)\s*[^\s]*/g;

export function parseTime(str: string): number {
	const [h, m] = str.split(":").map(Number);
	return h * 60 + m;
}

export function formatTime(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Round to nearest 5 minutes */
function roundTo5(minutes: number): number {
	return Math.round(minutes / 5) * 5;
}

function parseCheckbox(ch: string): CheckboxState {
	if (ch === "x") return "actual";
	if (ch === ">") return "deferred";
	return "plan";
}

function checkboxChar(state: CheckboxState): string {
	if (state === "actual") return "x";
	if (state === "deferred") return ">";
	return " ";
}

/**
 * Parse timeline items from a markdown note content.
 * Finds the given heading and parses checkbox list items until the next heading or EOF.
 * Returns items and any parse warnings for malformed lines.
 */
export function parseTimelineItems(
	content: string,
	heading: string
): ParseResult {
	const lines = content.split("\n");
	const warnings: ParseWarning[] = [];

	// Find the heading line
	const headingLevel = (heading.match(/^#+/) || [""])[0].length;
	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === heading.trim()) {
			startIdx = i + 1;
			break;
		}
	}
	if (startIdx === -1) return { items: [], warnings: [] };

	// Find the end: next heading of same or higher level, or EOF
	let endIdx = lines.length;
	for (let i = startIdx; i < lines.length; i++) {
		const match = lines[i].match(/^(#+)\s/);
		if (match && match[1].length <= headingLevel) {
			endIdx = i;
			break;
		}
	}

	const items: TimelineItem[] = [];
	for (let i = startIdx; i < endIdx; i++) {
		const line = lines[i];
		const m = TIMELINE_RE.exec(line);
		if (!m) {
			// Warn if it looks like a checkbox item but failed to parse
			if (line.trim() && CHECKBOX_LINE_RE.test(line.trim())) {
				warnings.push({ line: i + 1, message: `Could not parse timeline format: "${line.trim()}"` });
			}
			continue;
		}

		const checkbox = parseCheckbox(m[1]);
		const planStart = roundTo5(parseTime(m[2]));
		const planEnd = roundTo5(parseTime(m[3]));

		// Validate: end must be after start
		if (planEnd <= planStart) {
			warnings.push({ line: i + 1, message: `End time must be after start time: "${line.trim()}"` });
			continue;
		}

		let actualTime: TimeRange | undefined;
		if (m[4] && m[5]) {
			const actStart = roundTo5(parseTime(m[4]));
			const actEnd = roundTo5(parseTime(m[5]));
			if (actEnd > actStart) {
				actualTime = { start: actStart, end: actEnd };
			} else {
				warnings.push({ line: i + 1, message: `Actual end time must be after start: "${line.trim()}"` });
			}
		}

		const rest = m[6];

		// Extract tags
		const tags: string[] = [];
		let tagMatch;
		const tagRe = new RegExp(TAG_RE.source, TAG_RE.flags);
		while ((tagMatch = tagRe.exec(rest)) !== null) {
			tags.push(tagMatch[1]);
		}

		// Extract Tasks metadata as rawSuffix
		const rawSuffixParts: string[] = [];
		let metaMatch;
		const metaRe = new RegExp(TASKS_META_RE.source, TASKS_META_RE.flags);
		while ((metaMatch = metaRe.exec(rest)) !== null) {
			rawSuffixParts.push(metaMatch[0]);
		}
		const rawSuffix = rawSuffixParts.join(" ");

		// Content = rest minus tags and Tasks metadata
		let content_text = rest;
		// Remove tags
		content_text = content_text.replace(TAG_RE, "");
		// Remove Tasks metadata
		content_text = content_text.replace(TASKS_META_RE, "");
		// Clean up whitespace
		content_text = content_text.replace(/\s+/g, " ").trim();

		items.push({
			id: generateItemId(),
			checkbox,
			planTime: { start: planStart, end: planEnd },
			actualTime,
			content: content_text,
			tags,
			rawSuffix,
			lineNumber: i,
		});
	}

	return { items, warnings };
}

// ── Inbox Checkbox Item Parsing ──

export interface CheckboxItem {
	content: string;
	tags: string[];
	rawSuffix: string;
	checked: boolean;
	lineNumber: number;
}

const INBOX_CHECKBOX_RE = /^- \[([ x>])\] (.+)$/;

/**
 * Parse checkbox items (without time ranges) from a note under a given heading.
 * Returns only unchecked items (- [ ]).
 */
export function parseCheckboxItems(
	content: string,
	heading: string
): CheckboxItem[] {
	const lines = content.split("\n");

	const headingLevel = (heading.match(/^#+/) || [""])[0].length;
	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === heading.trim()) {
			startIdx = i + 1;
			break;
		}
	}
	if (startIdx === -1) return [];

	let endIdx = lines.length;
	for (let i = startIdx; i < lines.length; i++) {
		const match = lines[i].match(/^(#+)\s/);
		if (match && match[1].length <= headingLevel) {
			endIdx = i;
			break;
		}
	}

	const items: CheckboxItem[] = [];
	for (let i = startIdx; i < endIdx; i++) {
		const line = lines[i];
		const m = INBOX_CHECKBOX_RE.exec(line);
		if (!m) continue;

		const checkChar = m[1];
		// Only include unchecked items
		if (checkChar !== " ") continue;

		const rest = m[2];

		// Extract tags
		const tags: string[] = [];
		let tagMatch;
		const tagRe = new RegExp(TAG_RE.source, TAG_RE.flags);
		while ((tagMatch = tagRe.exec(rest)) !== null) {
			tags.push(tagMatch[1]);
		}

		// Extract Tasks metadata as rawSuffix
		const rawSuffixParts: string[] = [];
		let metaMatch;
		const metaRe = new RegExp(TASKS_META_RE.source, TASKS_META_RE.flags);
		while ((metaMatch = metaRe.exec(rest)) !== null) {
			rawSuffixParts.push(metaMatch[0]);
		}
		const rawSuffix = rawSuffixParts.join(" ");

		// Content = rest minus tags and Tasks metadata
		let contentText = rest;
		contentText = contentText.replace(TAG_RE, "");
		contentText = contentText.replace(TASKS_META_RE, "");
		contentText = contentText.replace(/\s+/g, " ").trim();

		items.push({
			content: contentText,
			tags,
			rawSuffix,
			checked: false,
			lineNumber: i,
		});
	}

	return items;
}

/**
 * Serialize content/tags/rawSuffix back to an inbox checkbox line.
 */
export function serializeCheckboxItem(
	content: string,
	tags: string[],
	rawSuffix: string
): string {
	const parts = [content];
	for (const tag of tags) {
		parts.push(`#${tag}`);
	}
	if (rawSuffix) {
		parts.push(rawSuffix);
	}
	return `- [ ] ${parts.join(" ")}`;
}

/**
 * Serialize a TimelineItem back to a markdown line.
 */
export function serializeTimelineItem(item: TimelineItem): string {
	const ch = checkboxChar(item.checkbox);
	let timeStr = `${formatTime(item.planTime.start)}-${formatTime(item.planTime.end)}`;
	if (item.actualTime) {
		timeStr += ` > ${formatTime(item.actualTime.start)}-${formatTime(item.actualTime.end)}`;
	}

	const parts = [item.content];
	for (const tag of item.tags) {
		parts.push(`#${tag}`);
	}
	if (item.rawSuffix) {
		parts.push(item.rawSuffix);
	}

	return `- [${ch}] ${timeStr} ${parts.join(" ")}`;
}

/**
 * Replace the timeline section in a note's content with new items.
 * If the heading doesn't exist, appends it at the end.
 * If content is empty (new file), creates heading + items.
 */
export function updateTimelineSection(
	content: string,
	heading: string,
	items: TimelineItem[]
): string {
	const serialized = items.map(serializeTimelineItem);
	const lines = content.split("\n");

	const headingLevel = (heading.match(/^#+/) || [""])[0].length;
	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === heading.trim()) {
			startIdx = i + 1;
			break;
		}
	}

	if (startIdx === -1) {
		// Heading not found: append at end
		const suffix = content.endsWith("\n") ? "" : "\n";
		const newSection = `${heading}\n${serialized.join("\n")}`;
		return content + suffix + "\n" + newSection + "\n";
	}

	// Find end of section
	let endIdx = lines.length;
	for (let i = startIdx; i < lines.length; i++) {
		const match = lines[i].match(/^(#+)\s/);
		if (match && match[1].length <= headingLevel) {
			endIdx = i;
			break;
		}
	}

	// Replace section content
	const before = lines.slice(0, startIdx);
	const after = lines.slice(endIdx);
	const result = [...before, ...serialized, ...after];

	return result.join("\n");
}
