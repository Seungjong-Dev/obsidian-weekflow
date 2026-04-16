import { ItemView, type WorkspaceLeaf, type TAbstractFile, moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type WeekFlowPlugin from "./main";
import { VIEW_TYPE_WEEKFLOW_STATS } from "./types";
import type { CategoryStats, ProjectStats, PlanActualSummary, TimelineItem, StatisticsRange } from "./types";
import { getWeekDates, resolveDailyNotePath } from "./daily-note";
import {
	calculateCategoryStats,
	calculateProjectStats,
	calculatePlanActualSummary,
	calculateBurningRateFromDateItems,
	calculateTimeDistribution,
	formatHours,
} from "./statistics";
import type { BurningRatePoint, TimeDistributionPoint } from "./statistics";
import { StatsCache } from "./stats-cache";

export class StatsView extends ItemView {
	plugin: WeekFlowPlugin;
	private currentDate: Moment = window.moment();
	private currentRange: StatisticsRange = "weekly";
	private categoryStats: CategoryStats[] = [];
	private projectStats: ProjectStats[] = [];
	private summary: PlanActualSummary = {
		totalPlanItems: 0,
		completedItems: 0,
		deferredItems: 0,
		unplannedActualItems: 0,
		completionRate: 0,
		deferredRate: 0,
	};
	private burningRate: BurningRatePoint[] = [];
	private timeDistribution: TimeDistributionPoint[] = [];
	private statsCache = new StatsCache();

	constructor(leaf: WorkspaceLeaf, plugin: WeekFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_WEEKFLOW_STATS;
	}

	getDisplayText(): string {
		return "WeekFlow Statistics";
	}

	getIcon(): string {
		return "chart-bar";
	}

	async onOpen() {
		// Invalidate cache on file modify
		this.registerEvent(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				// Check if this is a daily note — invalidate by date key
				const settings = this.plugin.settings;
				const dates = this.getDatesForRange();
				for (const date of dates) {
					const path = resolveDailyNotePath(settings.dailyNotePath, date);
					if (file.path === path) {
						this.statsCache.invalidate(date.format("YYYY-MM-DD"));
					}
				}
			})
		);

		await this.refresh();
	}

	async onClose() {}

	async refresh() {
		const settings = this.plugin.settings;
		const dates = this.getDatesForRange();

		// Load all items using cache
		const allItems = await this.statsCache.loadRange(
			this.app.vault,
			dates,
			settings
		);

		// Build date→items map for chart calculations
		const dateItemsMap = new Map<string, TimelineItem[]>();
		for (const date of dates) {
			dateItemsMap.set(date.format("YYYY-MM-DD"), []);
		}
		// Re-load per-date for chart grouping (items from cache don't carry date info)
		// Parse items again from cache individually
		for (const date of dates) {
			const dateKey = date.format("YYYY-MM-DD");
			const singleDayItems = await this.statsCache.loadRange(
				this.app.vault,
				[date],
				settings
			);
			dateItemsMap.set(dateKey, singleDayItems);
		}

		this.categoryStats = calculateCategoryStats(allItems, settings.categories);
		this.projectStats = calculateProjectStats(allItems);
		this.summary = calculatePlanActualSummary(allItems);
		this.burningRate = calculateBurningRateFromDateItems(
			dateItemsMap,
			dates,
			this.currentRange,
			settings.weekStartDay
		);
		this.timeDistribution = calculateTimeDistribution(
			dateItemsMap,
			dates,
			this.currentRange
		);

		this.renderView();
	}

	private getDatesForRange(): Moment[] {
		const settings = this.plugin.settings;
		switch (this.currentRange) {
			case "weekly":
				return getWeekDates(this.currentDate, settings.weekStartDay);
			case "monthly": {
				const start = this.currentDate.clone().startOf("month");
				const end = this.currentDate.clone().endOf("month");
				const dates: Moment[] = [];
				const d = start.clone();
				while (d.isSameOrBefore(end, "day")) {
					dates.push(d.clone());
					d.add(1, "day");
				}
				return dates;
			}
			case "quarterly": {
				const q = Math.floor(this.currentDate.month() / 3);
				const start = this.currentDate.clone().month(q * 3).startOf("month");
				const end = start.clone().add(2, "months").endOf("month");
				const dates: Moment[] = [];
				const d = start.clone();
				while (d.isSameOrBefore(end, "day")) {
					dates.push(d.clone());
					d.add(1, "day");
				}
				return dates;
			}
			case "yearly": {
				const start = this.currentDate.clone().startOf("year");
				const end = this.currentDate.clone().endOf("year");
				const dates: Moment[] = [];
				const d = start.clone();
				while (d.isSameOrBefore(end, "day")) {
					dates.push(d.clone());
					d.add(1, "day");
				}
				return dates;
			}
		}
	}

	private getRangeLabel(): string {
		switch (this.currentRange) {
			case "weekly":
				return this.currentDate.format("[W]ww, YYYY");
			case "monthly":
				return this.currentDate.format("MMMM YYYY");
			case "quarterly": {
				const q = Math.floor(this.currentDate.month() / 3) + 1;
				return `${this.currentDate.format("YYYY")} Q${q}`;
			}
			case "yearly":
				return this.currentDate.format("YYYY");
		}
	}

	private navigate(delta: number) {
		switch (this.currentRange) {
			case "weekly":
				this.currentDate = this.currentDate.clone().add(delta * 7, "days");
				break;
			case "monthly":
				this.currentDate = this.currentDate.clone().add(delta, "months");
				break;
			case "quarterly":
				this.currentDate = this.currentDate.clone().add(delta * 3, "months");
				break;
			case "yearly":
				this.currentDate = this.currentDate.clone().add(delta, "years");
				break;
		}
		this.refresh();
	}

	private renderView() {
		const container = this.contentEl;
		container.empty();
		container.addClass("weekflow-stats-container");

		// Header
		const header = container.createDiv({ cls: "weekflow-stats-header" });

		// Navigation
		const nav = header.createDiv({ cls: "weekflow-stats-nav" });
		const prevBtn = nav.createEl("button", { text: "\u25C0" });
		prevBtn.addEventListener("click", () => this.navigate(-1));

		const label = nav.createSpan({ cls: "weekflow-stats-label" });
		label.setText(this.getRangeLabel());

		const nextBtn = nav.createEl("button", { text: "\u25B6" });
		nextBtn.addEventListener("click", () => this.navigate(1));

		const todayBtn = nav.createEl("button", { text: "Today" });
		todayBtn.addEventListener("click", () => {
			this.currentDate = window.moment();
			this.refresh();
		});

		// Range selection
		const rangeBar = header.createDiv({ cls: "weekflow-stats-range" });
		const ranges: StatisticsRange[] = ["weekly", "monthly", "quarterly", "yearly"];
		const rangeLabels: Record<StatisticsRange, string> = {
			weekly: "Weekly",
			monthly: "Monthly",
			quarterly: "Quarterly",
			yearly: "Yearly",
		};
		for (const range of ranges) {
			const btn = rangeBar.createEl("button", { text: rangeLabels[range] });
			if (range === this.currentRange) btn.addClass("active");
			btn.addEventListener("click", () => {
				this.currentRange = range;
				this.refresh();
			});
		}

		// Content
		const content = container.createDiv({ cls: "weekflow-stats-content" });

		// Category section
		this.renderCategorySection(content);

		// Burning Rate chart
		this.renderBurningRateChart(content);

		// Time Distribution chart
		this.renderTimeDistributionChart(content);

		// Project section
		this.renderProjectSection(content);

		// Summary section
		this.renderSummarySection(content);
	}

	private renderCategorySection(container: HTMLElement) {
		const section = container.createDiv({ cls: "weekflow-stats-section" });
		section.createEl("h3", { text: "Category Time Distribution" });

		if (this.categoryStats.length === 0) {
			section.createEl("p", {
				text: "No data for this period.",
				cls: "weekflow-stats-empty",
			});
			return;
		}

		const table = section.createEl("table", { cls: "weekflow-stats-table" });
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "Category" });
		headerRow.createEl("th", { text: "Plan" });
		headerRow.createEl("th", { text: "Actual" });
		headerRow.createEl("th", { text: "Achievement" });

		const tbody = table.createEl("tbody");
		for (const stat of this.categoryStats) {
			const row = tbody.createEl("tr");

			const nameCell = row.createEl("td");
			const dot = nameCell.createSpan({ cls: "weekflow-stats-dot" });
			dot.style.backgroundColor = stat.color;
			nameCell.createSpan({ text: stat.label });

			row.createEl("td", { text: formatHours(stat.planMinutes) });
			row.createEl("td", { text: formatHours(stat.actualMinutes) });

			const barCell = row.createEl("td");
			const barContainer = barCell.createDiv({ cls: "weekflow-stats-progress-bar" });
			const fill = barContainer.createDiv({ cls: "weekflow-stats-progress-fill" });
			fill.style.width = `${Math.min(stat.achievementRate, 100)}%`;
			fill.style.backgroundColor = stat.color;
			barCell.createSpan({
				text: `${stat.achievementRate}%`,
				cls: "weekflow-stats-bar-label",
			});
		}
	}

	// ── Burning Rate (Stacked Bar Chart) ──

	private renderBurningRateChart(container: HTMLElement) {
		const section = container.createDiv({ cls: "weekflow-stats-section" });
		section.createEl("h3", { text: "Activity Trend" });

		if (this.burningRate.length === 0) {
			section.createEl("p", { text: "No data.", cls: "weekflow-stats-empty" });
			return;
		}

		// Collect all tags for color mapping
		const allTags = new Set<string>();
		for (const point of this.burningRate) {
			for (const tag of point.categoryMinutes.keys()) {
				allTags.add(tag);
			}
		}

		// Find max total for scaling
		let maxTotal = 0;
		for (const point of this.burningRate) {
			let total = 0;
			for (const mins of point.categoryMinutes.values()) {
				total += mins;
			}
			if (total > maxTotal) maxTotal = total;
		}

		if (maxTotal === 0) {
			section.createEl("p", { text: "No actual data.", cls: "weekflow-stats-empty" });
			return;
		}

		const chartHeight = 160;
		const chart = section.createDiv({ cls: "weekflow-chart-stacked" });
		chart.style.height = `${chartHeight + 30}px`; // + x-axis labels

		// Y-axis
		const yAxis = chart.createDiv({ cls: "weekflow-chart-yaxis" });
		const yMax = yAxis.createDiv({ cls: "weekflow-chart-ylabel" });
		yMax.setText(formatHours(maxTotal));
		const yMid = yAxis.createDiv({ cls: "weekflow-chart-ylabel" });
		yMid.setText(formatHours(Math.round(maxTotal / 2)));
		yMid.style.top = "50%";
		const yZero = yAxis.createDiv({ cls: "weekflow-chart-ylabel" });
		yZero.setText("0h");
		yZero.style.top = "100%";

		// Bars area
		const barsArea = chart.createDiv({ cls: "weekflow-chart-bars" });
		barsArea.style.height = `${chartHeight}px`;

		for (const point of this.burningRate) {
			const col = barsArea.createDiv({ cls: "weekflow-chart-col" });

			// Stack segments bottom-up
			let total = 0;
			for (const mins of point.categoryMinutes.values()) {
				total += mins;
			}
			const barHeight = maxTotal > 0 ? (total / maxTotal) * chartHeight : 0;

			const bar = col.createDiv({ cls: "weekflow-chart-bar" });
			bar.style.height = `${barHeight}px`;

			const tagArray = Array.from(point.categoryMinutes.entries());
			for (const [tag, mins] of tagArray) {
				const segHeight = total > 0 ? (mins / total) * barHeight : 0;
				const seg = bar.createDiv({ cls: "weekflow-chart-segment" });
				seg.style.height = `${segHeight}px`;
				seg.style.backgroundColor = this.getTagColor(tag);
				seg.ariaLabel = `${tag}: ${formatHours(mins)}`;
			}

			// X-axis label
			const xLabel = col.createDiv({ cls: "weekflow-chart-xlabel" });
			xLabel.setText(point.label);
		}
	}

	// ── Time Distribution (Horizontal Bar Chart) ──

	private renderTimeDistributionChart(container: HTMLElement) {
		const section = container.createDiv({ cls: "weekflow-stats-section" });
		section.createEl("h3", { text: "Time Distribution" });

		if (this.timeDistribution.length === 0) {
			section.createEl("p", { text: "No data.", cls: "weekflow-stats-empty" });
			return;
		}

		let maxMinutes = 0;
		for (const point of this.timeDistribution) {
			if (point.totalMinutes > maxMinutes) maxMinutes = point.totalMinutes;
		}

		if (maxMinutes === 0) {
			section.createEl("p", { text: "No actual data.", cls: "weekflow-stats-empty" });
			return;
		}

		const chartEl = section.createDiv({ cls: "weekflow-chart-hbar" });

		for (const point of this.timeDistribution) {
			const row = chartEl.createDiv({ cls: "weekflow-chart-hbar-row" });

			const labelEl = row.createDiv({ cls: "weekflow-chart-hbar-label" });
			labelEl.setText(point.label);

			const barContainer = row.createDiv({ cls: "weekflow-chart-hbar-track" });
			const fill = barContainer.createDiv({ cls: "weekflow-chart-hbar-fill" });
			const pct = maxMinutes > 0 ? (point.totalMinutes / maxMinutes) * 100 : 0;
			fill.style.width = `${pct}%`;

			const valueEl = row.createDiv({ cls: "weekflow-chart-hbar-value" });
			valueEl.setText(formatHours(point.totalMinutes));
		}
	}

	private renderProjectSection(container: HTMLElement) {
		const section = container.createDiv({ cls: "weekflow-stats-section" });
		section.createEl("h3", { text: "Project Time" });

		if (this.projectStats.length === 0) {
			section.createEl("p", {
				text: "No project data for this period.",
				cls: "weekflow-stats-empty",
			});
			return;
		}

		const table = section.createEl("table", { cls: "weekflow-stats-table" });
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "Project" });
		headerRow.createEl("th", { text: "Plan" });
		headerRow.createEl("th", { text: "Actual" });

		const tbody = table.createEl("tbody");
		for (const stat of this.projectStats) {
			const row = tbody.createEl("tr");
			row.createEl("td", { text: stat.projectName });
			row.createEl("td", { text: formatHours(stat.planMinutes) });
			row.createEl("td", { text: formatHours(stat.actualMinutes) });
		}
	}

	private renderSummarySection(container: HTMLElement) {
		const section = container.createDiv({ cls: "weekflow-stats-section" });
		section.createEl("h3", { text: "Plan vs Actual Summary" });

		// Narrative summary
		const { completedItems, totalPlanItems, deferredItems, unplannedActualItems, completionRate } = this.summary;
		if (totalPlanItems > 0 || unplannedActualItems > 0) {
			const narrative = section.createDiv({ cls: "weekflow-stats-narrative" });
			const parts: string[] = [];
			if (totalPlanItems > 0) parts.push(`${completedItems} of ${totalPlanItems} planned items completed`);
			if (deferredItems > 0) parts.push(`${deferredItems} deferred`);
			if (unplannedActualItems > 0) parts.push(`${unplannedActualItems} unplanned`);
			narrative.setText(parts.join(", ") + ".");
		}

		const grid = section.createDiv({ cls: "weekflow-stats-summary-grid" });

		this.renderSummaryCard(
			grid,
			this.summary.completionRate,
			"Completion Rate",
			`${completedItems} / ${totalPlanItems}`,
			true
		);

		this.renderSummaryCard(
			grid,
			this.summary.deferredRate,
			"Deferred Rate",
			`${deferredItems} items`,
			true
		);

		this.renderSummaryCard(
			grid,
			this.summary.unplannedActualItems,
			"Unplanned Actuals",
			"Without prior plan",
			false
		);
	}

	private getRateColor(rate: number, invert = false): string {
		const r = invert ? 100 - rate : rate;
		if (r >= 75) return "var(--color-green, #4ade80)";
		if (r >= 50) return "var(--color-yellow, #facc15)";
		return "var(--color-red, #f87171)";
	}

	private renderSummaryCard(
		container: HTMLElement,
		value: number,
		label: string,
		description: string,
		isRate: boolean
	) {
		const card = container.createDiv({ cls: "weekflow-stats-card" });

		if (isRate) {
			// Progress ring
			const ringSize = 56;
			const strokeWidth = 5;
			const radius = (ringSize - strokeWidth) / 2;
			const circumference = 2 * Math.PI * radius;
			const offset = circumference - (value / 100) * circumference;
			const color = this.getRateColor(value, label === "Deferred Rate");

			const ringContainer = card.createDiv({ cls: "weekflow-stats-ring-container" });
			const svg = createSvg("svg");
			svg.setAttribute("width", String(ringSize));
			svg.setAttribute("height", String(ringSize));
			svg.setAttribute("viewBox", `0 0 ${ringSize} ${ringSize}`);

			const bgCircle = createSvg("circle");
			bgCircle.setAttribute("cx", String(ringSize / 2));
			bgCircle.setAttribute("cy", String(ringSize / 2));
			bgCircle.setAttribute("r", String(radius));
			bgCircle.setAttribute("fill", "none");
			bgCircle.setAttribute("stroke", "var(--background-modifier-border)");
			bgCircle.setAttribute("stroke-width", String(strokeWidth));
			svg.appendChild(bgCircle);

			const fgCircle = createSvg("circle");
			fgCircle.setAttribute("cx", String(ringSize / 2));
			fgCircle.setAttribute("cy", String(ringSize / 2));
			fgCircle.setAttribute("r", String(radius));
			fgCircle.setAttribute("fill", "none");
			fgCircle.setAttribute("stroke", color);
			fgCircle.setAttribute("stroke-width", String(strokeWidth));
			fgCircle.setAttribute("stroke-dasharray", String(circumference));
			fgCircle.setAttribute("stroke-dashoffset", String(offset));
			fgCircle.setAttribute("stroke-linecap", "round");
			fgCircle.setAttribute("transform", `rotate(-90 ${ringSize / 2} ${ringSize / 2})`);
			fgCircle.classList.add("weekflow-stats-ring-progress");
			svg.appendChild(fgCircle);

			ringContainer.appendChild(svg);

			const valueEl = ringContainer.createDiv({ cls: "weekflow-stats-ring-value" });
			valueEl.setText(`${value}%`);
		} else {
			card.createDiv({ cls: "weekflow-stats-card-value", text: String(value) });
		}

		card.createDiv({ cls: "weekflow-stats-card-label", text: label });
		card.createDiv({ cls: "weekflow-stats-card-desc", text: description });
	}

	private getTagColor(tag: string): string {
		const cat = this.plugin.settings.categories.find((c) => c.tag === tag);
		return cat?.color || "#888888";
	}
}
