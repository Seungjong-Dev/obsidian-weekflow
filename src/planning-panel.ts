import { setIcon } from "obsidian";
import type { PanelItem, TimeRange } from "./types";
import { formatTime } from "./parser";

export interface PanelSection {
	type: "overdue" | "inbox" | "project";
	title: string;
	icon: string;
	items: PanelItem[];
	collapsed: boolean;
	key?: string; // unique key for collapse state (defaults to type)
}

export interface PlanningPanelCallbacks {
	onItemDragStart(item: PanelItem, e: PointerEvent): void;
}

export class PlanningPanel {
	private containerEl: HTMLElement;
	private callbacks: PlanningPanelCallbacks;
	private sectionCollapseState: Map<string, boolean> = new Map();

	constructor(containerEl: HTMLElement, callbacks: PlanningPanelCallbacks) {
		this.containerEl = containerEl;
		this.callbacks = callbacks;
	}

	render(sections: PanelSection[]): void {
		this.containerEl.empty();

		for (const section of sections) {
			const collapseKey = section.key || section.type;
			// Restore persisted collapse state
			const savedCollapsed = this.sectionCollapseState.get(collapseKey);
			const isCollapsed = savedCollapsed !== undefined ? savedCollapsed : section.collapsed;

			const sectionEl = this.containerEl.createDiv({ cls: "weekflow-panel-section" });

			// Header
			const header = sectionEl.createDiv({ cls: "weekflow-panel-header" });
			const chevron = header.createSpan({ cls: "weekflow-panel-chevron" });
			setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");

			const iconEl = header.createSpan({ cls: "weekflow-panel-icon" });
			setIcon(iconEl, section.icon);

			header.createSpan({ text: `${section.title} (${section.items.length})`, cls: "weekflow-panel-title" });

			// Toggle collapse
			header.addEventListener("click", () => {
				const nowCollapsed = !this.sectionCollapseState.get(collapseKey);
				this.sectionCollapseState.set(collapseKey, nowCollapsed);
				this.render(sections);
			});

			if (isCollapsed) {
				this.sectionCollapseState.set(collapseKey, true);
				continue;
			}
			this.sectionCollapseState.set(collapseKey, false);

			// Items
			if (section.items.length === 0) {
				const emptyEl = sectionEl.createDiv({ cls: "weekflow-panel-empty" });
				emptyEl.setText("No items");
				continue;
			}

			const listEl = sectionEl.createDiv({ cls: "weekflow-panel-list" });
			for (const item of section.items) {
				const itemEl = listEl.createDiv({ cls: "weekflow-panel-item" });
				itemEl.setAttribute("draggable", "false"); // we use custom mousedown drag

				// Build display text
				const label = this.buildItemLabel(item);
				itemEl.setText(label);

				if (item.tags.length > 0) {
					const tagEl = itemEl.createSpan({ cls: "weekflow-panel-item-tag" });
					tagEl.setText(`#${item.tags[0]}`);
				}

				// Drag via pointerdown
				itemEl.addEventListener("pointerdown", (e) => {
					if (e.button !== 0) return;
					e.preventDefault();
					this.callbacks.onItemDragStart(item, e);
				});
			}
		}
	}

	private buildItemLabel(item: PanelItem): string {
		const src = item.source;
		if (src.type === "overdue") {
			const date = src.dateKey.slice(5); // MM-DD
			const time = `${formatTime(src.planTime.start)}-${formatTime(src.planTime.end)}`;
			return `${date} ${time} ${item.content}`;
		}
		return item.content;
	}

	destroy(): void {
		this.containerEl.empty();
	}
}
