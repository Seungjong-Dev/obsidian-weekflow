import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, VIEW_TYPE_WEEKFLOW } from "./types";
import type { WeekFlowSettings } from "./types";
import { WeekFlowSettingTab } from "./settings";
import { WeekFlowView } from "./view";

export default class WeekFlowPlugin extends Plugin {
	settings: WeekFlowSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_WEEKFLOW,
			(leaf) => new WeekFlowView(leaf, this)
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

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
