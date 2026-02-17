import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, VIEW_TYPE_WEEKFLOW, VIEW_TYPE_WEEKFLOW_STATS } from "./types";
import type { WeekFlowSettings } from "./types";
import { WeekFlowSettingTab } from "./settings";
import { WeekFlowView } from "./view";
import { StatsView } from "./stats-view";

export default class WeekFlowPlugin extends Plugin {
	settings: WeekFlowSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_WEEKFLOW,
			(leaf) => new WeekFlowView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_WEEKFLOW_STATS,
			(leaf) => new StatsView(leaf, this)
		);

		this.addRibbonIcon("calendar-clock", "Open WeekFlow", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-weekflow-view",
			name: "Open weekly view",
			callback: () => {
				this.activateView();
			},
		});

		this.addCommand({
			id: "weekflow-undo",
			name: "Undo",
			hotkeys: [{ modifiers: ["Mod"], key: "z" }],
			checkCallback: (checking: boolean) => {
				const view = this.getWeekFlowView();
				if (!view) return false;
				if (!checking) view.undo();
				return true;
			},
		});

		this.addCommand({
			id: "weekflow-redo",
			name: "Redo",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "z" }],
			checkCallback: (checking: boolean) => {
				const view = this.getWeekFlowView();
				if (!view) return false;
				if (!checking) view.redo();
				return true;
			},
		});

		this.addCommand({
			id: "weekflow-toggle-panel",
			name: "Toggle planning panel",
			checkCallback: (checking: boolean) => {
				const view = this.getWeekFlowView();
				if (!view) return false;
				if (!checking) view.togglePlanningPanel();
				return true;
			},
		});

		this.addCommand({
			id: "weekflow-open-statistics",
			name: "Open statistics",
			callback: () => this.activateStatsView(),
		});

		this.addSettingTab(new WeekFlowSettingTab(this.app, this));
	}

	onunload() {}

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_WEEKFLOW)[0];
		if (!leaf) {
			const newLeaf = workspace.getLeaf("tab");
			await newLeaf.setViewState({
				type: VIEW_TYPE_WEEKFLOW,
				active: true,
			});
			leaf = newLeaf;
		}
		workspace.revealLeaf(leaf);
	}

	async activateStatsView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_WEEKFLOW_STATS)[0];
		if (!leaf) {
			const newLeaf = workspace.getLeaf("tab");
			await newLeaf.setViewState({
				type: VIEW_TYPE_WEEKFLOW_STATS,
				active: true,
			});
			leaf = newLeaf;
		}
		workspace.revealLeaf(leaf);
	}

	private getWeekFlowView(): WeekFlowView | null {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKFLOW)[0];
		if (!leaf) return null;
		return leaf.view as WeekFlowView;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
