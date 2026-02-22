import type { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { PanelItem, TimelineItem } from "./types";
import type { PanelSection } from "./planning-panel";
import type { ProjectInfo, InboxCheckboxItem } from "./daily-note";
import type { CheckboxItem } from "./parser";
import { generateItemId, extractBlockId } from "./parser";

export function collectOverdueItems(
	dates: Moment[],
	weekData: Map<string, TimelineItem[]>
): PanelItem[] {
	const today = window.moment().startOf("day");
	const items: PanelItem[] = [];
	for (let i = 0; i < 7; i++) {
		if (dates[i].isSameOrAfter(today, "day")) continue;
		const dateKey = dates[i].format("YYYY-MM-DD");
		for (const item of (weekData.get(dateKey) || [])) {
			if (item.checkbox !== "plan") continue;
			items.push({
				id: generateItemId(),
				content: item.content,
				tags: [...item.tags],
				rawSuffix: item.rawSuffix,
				source: {
					type: "overdue",
					dateKey,
					planTime: { ...item.planTime },
					originalId: item.id,
					lineNumber: item.lineNumber,
				},
			});
		}
	}
	return items;
}

export function collectInboxPanelItems(
	inboxItems: InboxCheckboxItem[]
): PanelItem[] {
	return inboxItems.map((ci) => ({
		id: generateItemId(),
		content: ci.content,
		tags: [...ci.tags],
		rawSuffix: ci.rawSuffix,
		source: {
			type: "inbox" as const,
			notePath: ci.sourcePath,
			lineNumber: ci.lineNumber,
		},
	}));
}

export function collectProjectSections(
	projectData: { project: ProjectInfo; tasks: CheckboxItem[] }[]
): PanelSection[] {
	return projectData.filter(({ tasks }) => tasks.length > 0).map(({ project, tasks }) => ({
		type: "project" as const,
		title: project.title,
		icon: "folder",
		key: `project:${project.path}`,
		items: tasks.map((task) => ({
			id: generateItemId(),
			content: task.content,
			tags: [...task.tags],
			rawSuffix: task.rawSuffix,
			source: {
				type: "project" as const,
				projectPath: project.path,
				blockId: extractBlockIdFromRaw(task),
			},
		})),
		collapsed: false,
	}));
}

export function extractBlockIdFromRaw(task: CheckboxItem): string | undefined {
	const parts = [task.content];
	for (const tag of task.tags) parts.push(`#${tag}`);
	if (task.rawSuffix) parts.push(task.rawSuffix);
	const line = `- [ ] ${parts.join(" ")}`;
	return extractBlockId(line);
}
