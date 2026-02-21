import { setIcon, Menu } from "obsidian";
import type { PanelItem, TimeRange } from "./types";
import { formatTime } from "./parser";

export interface PanelSection {
	type: "overdue" | "inbox" | "project";
	title: string;
	icon: string;
	items: PanelItem[];
	collapsed: boolean;
	key?: string; // unique key for collapse state (defaults to type)
	canAddItem?: boolean; // show add-item UI (inbox only)
	showSourcePath?: boolean; // show source file path per item
	onAddItem?: (text: string) => void; // callback when user adds new item
}

export interface PlanningPanelCallbacks {
	onItemDragStart(item: PanelItem, e: PointerEvent): void;
	onItemNavigate?(item: PanelItem): void;
}

export class PlanningPanel {
	private containerEl: HTMLElement;
	private callbacks: PlanningPanelCallbacks;
	private sectionCollapseState: Map<string, boolean> = new Map();

	// Touch selection state
	private selectedItemEl: HTMLElement | null = null;
	private selectedItem: PanelItem | null = null;
	private lastPointerType: string = "mouse";

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

			// Add-item UI (inbox section, when note source exists)
			if (section.canAddItem && section.onAddItem) {
				const addRow = sectionEl.createDiv({ cls: "weekflow-panel-add-row" });
				const input = addRow.createEl("input", {
					type: "text",
					cls: "weekflow-panel-add-input",
					placeholder: "+ Add item...",
				});
				const onAdd = section.onAddItem;
				input.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && input.value.trim()) {
						onAdd(input.value.trim());
						input.value = "";
					}
				});
			}

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

				// Source path (when multiple sources)
				if (section.showSourcePath && item.source.type === "inbox") {
					const srcEl = itemEl.createSpan({ cls: "weekflow-panel-item-source" });
					const shortPath = item.source.notePath.replace(/\.md$/, "");
					srcEl.setText(shortPath);
				}

				// Navigation icon (inbox and overdue only)
				if (this.callbacks.onItemNavigate && (item.source.type === "inbox" || item.source.type === "overdue")) {
					const navBtn = itemEl.createDiv({ cls: "weekflow-panel-item-nav" });
					setIcon(navBtn, "arrow-up-right");
					navBtn.ariaLabel = item.source.type === "inbox" ? "Go to source note" : "Go to daily note";
					navBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
					navBtn.addEventListener("click", (e) => { e.stopPropagation(); this.callbacks.onItemNavigate!(item); });
				}

				// Context menu
				if (this.callbacks.onItemNavigate && (item.source.type === "inbox" || item.source.type === "overdue")) {
					itemEl.addEventListener("contextmenu", (e) => {
						if (this.lastPointerType === "touch") return;
						e.preventDefault();
						e.stopPropagation();
						const menu = new Menu();
						const title = item.source.type === "inbox" ? "Go to source note" : "Go to daily note";
						menu.addItem((mi) => {
							mi.setTitle(title).setIcon("arrow-up-right").onClick(() => {
								this.callbacks.onItemNavigate!(item);
							});
						});
						menu.showAtMouseEvent(e);
					});
				}

				// Drag via pointerdown — touch vs mouse branching
				let startX = 0, startY = 0;

				itemEl.addEventListener("pointerdown", (e) => {
					if (e.button !== 0) return;
					this.lastPointerType = e.pointerType;
					if (e.pointerType === "touch") {
						// Touch: no preventDefault → allow scroll (pan-y)
						startX = e.clientX;
						startY = e.clientY;
						return;
					}
					// Mouse: immediate drag
					e.preventDefault();
					this.callbacks.onItemDragStart(item, e);
				});

				// Touch tap → select/deselect
				itemEl.addEventListener("click", (e) => {
					if (this.lastPointerType !== "touch") return;
					const dist = Math.sqrt((e.clientX - startX) ** 2 + (e.clientY - startY) ** 2);
					if (dist > 10) return; // Was a scroll

					if (this.selectedItem?.id === item.id) {
						this.deselectItem();
					} else {
						this.selectItem(item, itemEl);
					}
				});
			}
		}
	}

	private selectItem(item: PanelItem, itemEl: HTMLElement): void {
		this.deselectItem();
		this.selectedItem = item;
		this.selectedItemEl = itemEl;
		itemEl.addClass("weekflow-panel-item-selected");

		// Show nav icon
		const navBtn = itemEl.querySelector(".weekflow-panel-item-nav") as HTMLElement | null;
		if (navBtn) navBtn.style.opacity = "1";

		// Add action strip
		const actions = itemEl.createDiv({ cls: "weekflow-panel-item-actions" });

		// Drag handle button
		const dragBtn = actions.createDiv({ cls: "weekflow-panel-item-action-btn" });
		setIcon(dragBtn, "move");
		dragBtn.ariaLabel = "Drag to grid";
		dragBtn.addEventListener("pointerdown", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.callbacks.onItemDragStart(item, e);
		});

		// Navigate button
		if (this.callbacks.onItemNavigate && (item.source.type === "inbox" || item.source.type === "overdue")) {
			const navActionBtn = actions.createDiv({ cls: "weekflow-panel-item-action-btn" });
			setIcon(navActionBtn, "arrow-up-right");
			navActionBtn.ariaLabel = item.source.type === "inbox" ? "Go to source note" : "Go to daily note";
			navActionBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
			navActionBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.callbacks.onItemNavigate!(item);
			});
		}
	}

	public deselectAll(): void {
		this.deselectItem();
	}

	private deselectItem(): void {
		if (this.selectedItemEl) {
			this.selectedItemEl.removeClass("weekflow-panel-item-selected");
			// Remove action strip
			const actions = this.selectedItemEl.querySelector(".weekflow-panel-item-actions");
			if (actions) actions.remove();
			// Restore nav icon opacity
			const navBtn = this.selectedItemEl.querySelector(".weekflow-panel-item-nav") as HTMLElement | null;
			if (navBtn) navBtn.style.opacity = "";
		}
		this.selectedItem = null;
		this.selectedItemEl = null;
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
