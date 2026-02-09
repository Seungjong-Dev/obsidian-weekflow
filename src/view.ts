import { ItemView, type WorkspaceLeaf, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type WeekFlowPlugin from "./main";
import { VIEW_TYPE_WEEKFLOW } from "./types";
import type { TimelineItem, WeekFlowSettings } from "./types";
import { getWeekDates, loadWeekData, saveDailyNoteItems, getDailyNoteItems } from "./daily-note";
import { GridRenderer } from "./grid-renderer";
import { BlockModal } from "./block-modal";

export class WeekFlowView extends ItemView {
	plugin: WeekFlowPlugin;
	private currentDate: Moment = window.moment();
	private mode: "plan" | "actual";
	private dates: Moment[] = [];
	private weekData: Map<string, TimelineItem[]> = new Map();
	private gridRenderer: GridRenderer | null = null;
	private selectedCategory: string = "";

	constructor(leaf: WorkspaceLeaf, plugin: WeekFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.mode = plugin.settings.defaultMode;
	}

	getViewType(): string {
		return VIEW_TYPE_WEEKFLOW;
	}

	getDisplayText(): string {
		return "WeekFlow";
	}

	getIcon(): string {
		return "calendar-clock";
	}

	async onOpen() {
		await this.refresh();
	}

	async onClose() {}

	async refresh() {
		const settings = this.plugin.settings;
		this.dates = getWeekDates(this.currentDate, settings.weekStartDay);
		this.weekData = await loadWeekData(
			this.app.vault,
			this.dates,
			settings
		);
		this.renderView();
	}

	private renderView() {
		const container = this.contentEl;
		container.empty();
		container.addClass("weekflow-container");

		// Toolbar
		this.renderToolbar(container);

		// Grid wrapper
		const gridWrapper = container.createDiv({ cls: "weekflow-grid-wrapper" });

		this.gridRenderer = new GridRenderer(
			gridWrapper,
			this.plugin.settings,
			this.dates,
			this.weekData,
			this.mode,
			{
				onCellDragStart: () => {},
				onCellDragMove: () => {},
				onCellDragEnd: () => this.onDragEnd(),
				onBlockClick: (dayIndex, item) =>
					this.onBlockClick(dayIndex, item),
			}
		);
		this.gridRenderer.render();
		this.applyModeToGrid();
	}

	private applyModeToGrid() {
		const container = this.contentEl;
		container.removeClass("weekflow-mode-plan", "weekflow-mode-actual");
		container.addClass(`weekflow-mode-${this.mode}`);
	}

	private renderToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "weekflow-toolbar" });

		// Navigation
		const nav = toolbar.createDiv({ cls: "weekflow-toolbar-nav" });

		const prevBtn = nav.createEl("button", { text: "\u25C0" });
		prevBtn.addEventListener("click", () => this.navigateWeek(-1));

		const weekLabel = nav.createSpan({ cls: "weekflow-week-label" });
		const weekNum = this.dates[0].format("[W]ww, YYYY");
		weekLabel.setText(weekNum);

		const nextBtn = nav.createEl("button", { text: "\u25B6" });
		nextBtn.addEventListener("click", () => this.navigateWeek(1));

		const todayBtn = nav.createEl("button", { text: "Today" });
		todayBtn.addEventListener("click", () => {
			this.currentDate = window.moment();
			this.refresh();
		});

		const refreshBtn = nav.createEl("button", { text: "\u21BB" });
		refreshBtn.ariaLabel = "Refresh";
		refreshBtn.addEventListener("click", () => this.refresh());

		// Category palette
		const palette = toolbar.createDiv({ cls: "weekflow-palette" });
		for (const cat of this.plugin.settings.categories) {
			const btn = palette.createEl("button", {
				cls: "weekflow-palette-btn",
			});
			const dot = btn.createSpan({ cls: "weekflow-palette-dot" });
			dot.style.backgroundColor = cat.color;
			btn.createSpan({ text: cat.label || cat.tag });

			if (this.selectedCategory === cat.tag) {
				btn.addClass("active");
			}

			btn.addEventListener("click", () => {
				this.selectedCategory = cat.tag;
				palette.querySelectorAll(".weekflow-palette-btn").forEach((b) =>
					b.removeClass("active")
				);
				btn.addClass("active");
			});
		}

		// Mode toggle
		const modeToggle = toolbar.createDiv({ cls: "weekflow-mode-toggle" });

		const planBtn = modeToggle.createEl("button", {
			text: "Plan",
			cls: "weekflow-mode-btn",
		});
		const actualBtn = modeToggle.createEl("button", {
			text: "Actual",
			cls: "weekflow-mode-btn",
		});

		if (this.mode === "plan") planBtn.addClass("active");
		else actualBtn.addClass("active");

		planBtn.addEventListener("click", () => {
			this.mode = "plan";
			planBtn.addClass("active");
			actualBtn.removeClass("active");
			this.applyModeToGrid();
		});

		actualBtn.addEventListener("click", () => {
			this.mode = "actual";
			actualBtn.addClass("active");
			planBtn.removeClass("active");
			this.applyModeToGrid();
		});
	}

	private async navigateWeek(delta: number) {
		this.currentDate = this.currentDate
			.clone()
			.add(delta * 7, "days");
		await this.refresh();
	}

	private async onDragEnd() {
		if (!this.gridRenderer) return;

		const selection = this.gridRenderer.getSelection();
		if (!selection) return;

		const planTime = {
			start: selection.startMinutes,
			end: selection.endMinutes,
		};

		new BlockModal(
			this.app,
			planTime,
			this.mode,
			this.plugin.settings.categories,
			async (result) => {
				const checkbox = this.mode === "plan" ? "plan" : "actual";
				const newItem: TimelineItem = {
					checkbox: checkbox,
					planTime,
					content: result.content,
					tags: result.tag ? [result.tag] : [],
					rawSuffix: "",
				};

				// If actual mode and no plan time differs, set actualTime
				if (this.mode === "actual") {
					newItem.checkbox = "actual";
				}

				const date = this.dates[selection.dayIndex];
				const dateKey = date.format("YYYY-MM-DD");
				const existing = this.weekData.get(dateKey) || [];
				existing.push(newItem);
				this.weekData.set(dateKey, existing);

				await saveDailyNoteItems(
					this.app.vault,
					date,
					this.plugin.settings,
					existing
				);

				this.gridRenderer?.clearSelection();
				await this.refresh();
			}
		).open();
	}

	private onBlockClick(dayIndex: number, item: TimelineItem) {
		// Phase 1: just log — editing comes in Phase 2
		console.log("Block clicked:", item);
	}

	// Persist/restore view state
	getState(): Record<string, unknown> {
		return {
			currentDate: this.currentDate.format("YYYY-MM-DD"),
			mode: this.mode,
		};
	}

	async setState(state: any, result: { history: boolean }): Promise<void> {
		if (typeof state.currentDate === "string") {
			this.currentDate = window.moment(state.currentDate, "YYYY-MM-DD");
		}
		if (state.mode === "plan" || state.mode === "actual") {
			this.mode = state.mode;
		}
		await this.refresh();
	}
}
