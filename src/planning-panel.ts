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
	private actionBarEl: HTMLElement | null = null;
	private lastPointerType: string = "mouse";
	private scrollListener: (() => void) | null = null;
	private penDragTimer: ReturnType<typeof setTimeout> | null = null;

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

				// Navigation icon (mouse hover only — inbox and overdue)
				if (this.callbacks.onItemNavigate && (item.source.type === "inbox" || item.source.type === "overdue")) {
					const navBtn = itemEl.createDiv({ cls: "weekflow-panel-item-nav" });
					setIcon(navBtn, "arrow-up-right");
					navBtn.ariaLabel = item.source.type === "inbox" ? "Go to source note" : "Go to daily note";
					navBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
					navBtn.addEventListener("click", (e) => { e.stopPropagation(); this.callbacks.onItemNavigate!(item); });
				}

				// Context menu (mouse and pen — touch guarded)
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

				// Drag via pointerdown — touch vs mouse/pen branching
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
					// Mouse and Pen
					e.preventDefault();
					startX = e.clientX;
					startY = e.clientY;
					if (e.pointerType === "pen") {
						// Pen: delayed drag (150ms hold like grid mouse path)
						this.penDragTimer = setTimeout(() => {
							this.penDragTimer = null;
							this.callbacks.onItemDragStart(item, e);
						}, 150);
					} else {
						// Mouse: immediate drag
						this.callbacks.onItemDragStart(item, e);
					}
				});

				// Pen tap → cancel drag timer, show action bar
				itemEl.addEventListener("pointerup", (e) => {
					if (e.pointerType !== "pen") return;
					if (this.penDragTimer) {
						clearTimeout(this.penDragTimer);
						this.penDragTimer = null;
						const dist = Math.sqrt((e.clientX - startX) ** 2 + (e.clientY - startY) ** 2);
						if (dist > 10) return;
						if (this.selectedItem?.id === item.id) {
							this.deselectItem();
						} else {
							this.selectItem(item, itemEl);
						}
					}
				});

				// Touch tap → select/deselect
				itemEl.addEventListener("click", (e) => {
					if (this.lastPointerType !== "touch") return;
					const dist = Math.sqrt((e.clientX - startX) ** 2 + (e.clientY - startY) ** 2);
					if (dist > 10) return;
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

		// Hide hover nav icon while selected
		const navBtn = itemEl.querySelector(".weekflow-panel-item-nav") as HTMLElement | null;
		if (navBtn) navBtn.style.display = "none";

		// Mount action bar on document.body (fixed positioning, same pattern as grid)
		const bar = document.body.createDiv({ cls: "weekflow-panel-action-bar" });
		this.actionBarEl = bar;

		// Drag handle button
		const dragBtn = bar.createDiv({ cls: "weekflow-action-bar-btn" });
		setIcon(dragBtn, "move");
		dragBtn.ariaLabel = "Drag to grid";
		dragBtn.addEventListener("pointerdown", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.callbacks.onItemDragStart(item, e);
		});

		// Navigate button
		if (this.callbacks.onItemNavigate && (item.source.type === "inbox" || item.source.type === "overdue")) {
			const navActionBtn = bar.createDiv({ cls: "weekflow-action-bar-btn" });
			setIcon(navActionBtn, "arrow-up-right");
			navActionBtn.ariaLabel = item.source.type === "inbox" ? "Go to source note" : "Go to daily note";
			navActionBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
			navActionBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.callbacks.onItemNavigate!(item);
			});
		}

		this.positionActionBar(itemEl);

		// Deselect on panel scroll
		this.scrollListener = () => { this.deselectItem(); };
		this.containerEl.addEventListener("scroll", this.scrollListener, { passive: true });
	}

	public deselectAll(): void {
		this.deselectItem();
	}

	private deselectItem(): void {
		if (this.selectedItemEl) {
			this.selectedItemEl.removeClass("weekflow-panel-item-selected");
			// Restore hover nav icon
			const navBtn = this.selectedItemEl.querySelector(".weekflow-panel-item-nav") as HTMLElement | null;
			if (navBtn) navBtn.style.display = "";
		}
		if (this.actionBarEl) {
			this.actionBarEl.remove();
			this.actionBarEl = null;
		}
		if (this.scrollListener) {
			this.containerEl.removeEventListener("scroll", this.scrollListener);
			this.scrollListener = null;
		}
		this.selectedItem = null;
		this.selectedItemEl = null;
	}

	private positionActionBar(anchorEl: HTMLElement): void {
		if (!this.actionBarEl) return;
		const rect = anchorEl.getBoundingClientRect();
		const barHeight = this.actionBarEl.offsetHeight || 44;
		const gap = 4;

		// Below the item, clamped to viewport
		let top = rect.bottom + gap;
		top = Math.min(top, window.innerHeight - barHeight - 4);
		top = Math.max(4, top);

		const left = rect.left + rect.width / 2;
		this.actionBarEl.style.left = `${left}px`;
		this.actionBarEl.style.top = `${top}px`;

		// After render: clamp horizontally
		requestAnimationFrame(() => {
			if (!this.actionBarEl) return;
			const barRect = this.actionBarEl.getBoundingClientRect();
			if (barRect.left < 4) {
				this.actionBarEl.style.left = `${4 + barRect.width / 2}px`;
			} else if (barRect.right > window.innerWidth - 4) {
				this.actionBarEl.style.left = `${window.innerWidth - 4 - barRect.width / 2}px`;
			}
		});
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
		this.deselectItem();
		this.containerEl.empty();
	}
}
