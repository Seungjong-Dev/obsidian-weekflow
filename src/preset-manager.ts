import type { App } from "obsidian";
import type { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;
import type { TimelineItem, TimeSlotPreset, WeekFlowSettings } from "./types";
import { CreatePresetModal, ApplyPresetModal } from "./preset-modal";
import { generateItemId } from "./parser";
import type { UndoManager, UndoableAction } from "./undo-manager";

export interface PresetMenuOpts {
	app: App;
	settings: WeekFlowSettings;
	dates: Moment[];
	weekData: Map<string, TimelineItem[]>;
	event: MouseEvent | PointerEvent;
	guardedSave: (date: Moment, items: TimelineItem[]) => Promise<void>;
	undoManager: UndoManager;
	refresh: () => Promise<void>;
	saveSettings: () => Promise<void>;
}

export function showPresetMenu(opts: PresetMenuOpts): void {
	const { app, settings, dates, weekData, event: e } = opts;

	const menu = document.createElement("div");
	menu.className = "weekflow-preset-menu";
	menu.style.position = "fixed";
	menu.style.left = `${e.clientX}px`;
	menu.style.top = `${e.clientY}px`;
	menu.style.zIndex = "1000";
	menu.style.background = "var(--background-primary)";
	menu.style.border = "1px solid var(--background-modifier-border)";
	menu.style.borderRadius = "6px";
	menu.style.padding = "4px";
	menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
	menu.style.minWidth = "180px";

	// "Create preset from today" option
	const createItem = document.createElement("div");
	createItem.className = "weekflow-preset-menu-item";
	createItem.textContent = "Save current day as preset...";
	createItem.addEventListener("click", () => {
		menu.remove();
		createPresetFromToday(opts);
	});
	menu.appendChild(createItem);

	// Saved presets
	for (const preset of settings.presets) {
		const item = document.createElement("div");
		item.className = "weekflow-preset-menu-item";
		item.textContent = `${preset.name} (${preset.slots.length})`;
		item.addEventListener("click", () => {
			menu.remove();
			applyPreset(opts, preset);
		});
		menu.appendChild(item);
	}

	if (settings.presets.length === 0) {
		const empty = document.createElement("div");
		empty.className = "weekflow-preset-menu-item";
		empty.style.color = "var(--text-muted)";
		empty.textContent = "No presets saved";
		menu.appendChild(empty);
	}

	document.body.appendChild(menu);
	const closeMenu = (ev: PointerEvent) => {
		if (!menu.contains(ev.target as Node)) {
			menu.remove();
			document.removeEventListener("pointerdown", closeMenu);
		}
	};
	setTimeout(() => document.addEventListener("pointerdown", closeMenu), 0);
}

function createPresetFromToday(opts: PresetMenuOpts): void {
	const { app, settings, weekData } = opts;
	const todayKey = window.moment().format("YYYY-MM-DD");
	const items = weekData.get(todayKey) || [];
	const planItems = items.filter((i) => i.checkbox === "plan");
	const slots = planItems.map((i) => ({
		start: i.planTime.start,
		end: i.planTime.end,
		content: i.content,
		tag: i.tags[0] || "",
	}));
	new CreatePresetModal(app, slots, async (preset) => {
		settings.presets.push(preset);
		await opts.saveSettings();
	}).open();
}

function applyPreset(opts: PresetMenuOpts, preset: TimeSlotPreset): void {
	const { app, dates, weekData, guardedSave, undoManager } = opts;

	new ApplyPresetModal(
		app,
		preset,
		dates,
		async (selectedDays, overwrite) => {
			// Save old state for undo
			const oldData = new Map<string, TimelineItem[]>();
			for (const d of selectedDays) {
				const dateKey = dates[d].format("YYYY-MM-DD");
				const items = weekData.get(dateKey) || [];
				oldData.set(
					dateKey,
					items.map((i) => ({
						...i,
						planTime: { ...i.planTime },
						actualTime: i.actualTime
							? { ...i.actualTime }
							: undefined,
						tags: [...i.tags],
					}))
				);
			}

			for (const d of selectedDays) {
				const date = dates[d];
				const dateKey = date.format("YYYY-MM-DD");
				let existing = weekData.get(dateKey) || [];

				if (overwrite) {
					existing = existing.filter(
						(i) => i.checkbox !== "plan"
					);
				}

				for (const slot of preset.slots) {
					existing.push({
						id: generateItemId(),
						checkbox: "plan",
						planTime: { start: slot.start, end: slot.end },
						content: slot.content,
						tags: slot.tag ? [slot.tag] : [],
						rawSuffix: "",
					});
				}

				weekData.set(dateKey, existing);
				await guardedSave(date, existing);
			}

			const action: UndoableAction = {
				description: "Apply preset",
				execute: async () => {
					/* already executed */
				},
				undo: async () => {
					for (const [dateKey, items] of oldData) {
						weekData.set(dateKey, items);
						const d = selectedDays.find(
							(i) =>
								dates[i].format("YYYY-MM-DD") ===
								dateKey
						);
						if (d !== undefined) {
							await guardedSave(dates[d], items);
						}
					}
				},
			};
			undoManager.pushExecuted(action);
			await opts.refresh();
		}
	).open();
}
