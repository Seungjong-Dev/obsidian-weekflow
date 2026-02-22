import type { App } from "obsidian";
import { moment } from "obsidian";
type Moment = ReturnType<typeof moment>;

import type { TimelineItem, PanelItem, WeekFlowSettings } from "./types";
import { generateItemId, serializeCheckboxItem, generateBlockId } from "./parser";
import type { CheckboxItem } from "./parser";
import type { UndoableAction } from "./undo-manager";
import type { UndoManager } from "./undo-manager";
import {
	addToInbox,
	removeFromInboxFile,
	getInboxItems,
	appendBlockIdToLine,
	completeProjectTask,
} from "./daily-note";
import type { ProjectInfo } from "./daily-note";
import { ConfirmModal } from "./confirm-modal";

export interface BlockActionsContext {
	app: App;
	settings: WeekFlowSettings;
	dates: Moment[];
	weekData: Map<string, TimelineItem[]>;
	undoManager: UndoManager;
	guardedSave: (date: Moment, items: TimelineItem[]) => Promise<void>;
	withSelfWriteGuard: <T>(fn: () => Promise<T>) => Promise<T>;
	refresh: () => Promise<void>;
	projectData: { project: ProjectInfo; tasks: CheckboxItem[] }[];
}

export class BlockActions {
	private ctx: BlockActionsContext;

	constructor(ctx: BlockActionsContext) {
		this.ctx = ctx;
	}

	updateCtx(ctx: BlockActionsContext): void {
		this.ctx = ctx;
	}

	// ── Helpers ──────────────────────────────────────────────────────

	splitOvernightItem(
		item: TimelineItem,
		dayIndex: number
	): {
		today: TimelineItem;
		tomorrow: TimelineItem;
		todayKey: string;
		tomorrowKey: string;
		todayDayIndex: number;
		tomorrowDayIndex: number;
	} | null {
		const MIDNIGHT = 1440;
		if (item.planTime.end <= MIDNIGHT) return null;
		if (dayIndex >= 6) return null;

		const todayDayIndex = dayIndex;
		const tomorrowDayIndex = dayIndex + 1;
		const todayKey = this.ctx.dates[todayDayIndex].format("YYYY-MM-DD");
		const tomorrowKey = this.ctx.dates[tomorrowDayIndex].format("YYYY-MM-DD");

		const today: TimelineItem = {
			...item,
			id: generateItemId(),
			planTime: { start: item.planTime.start, end: MIDNIGHT },
		};
		const overflowMinutes = item.planTime.end - MIDNIGHT;
		const tomorrow: TimelineItem = {
			...item,
			id: generateItemId(),
			tags: [...item.tags],
			planTime: { start: 0, end: overflowMinutes },
		};

		return { today, tomorrow, todayKey, tomorrowKey, todayDayIndex, tomorrowDayIndex };
	}

	// ── Block drag (same-day & cross-day with deferred logic) ───────

	async onBlockDragEnd(
		item: TimelineItem,
		fromDay: number,
		toDay: number,
		newStart: number,
		newDuration?: number
	): Promise<void> {
		const dragTime =
			item.checkbox === "actual" && item.actualTime
				? item.actualTime
				: item.planTime;
		const duration = newDuration ?? (dragTime.end - dragTime.start);
		const newEnd =
			toDay >= 6
				? Math.min(newStart + duration, 1440)
				: newStart + duration;

		const fromDate = this.ctx.dates[fromDay];
		const fromKey = fromDate.format("YYYY-MM-DD");
		const toDate = this.ctx.dates[toDay];
		const toKey = toDate.format("YYYY-MM-DD");
		const oldStart = item.planTime.start;
		const oldEnd = item.planTime.end;

		if (fromDay === toDay) {
			await this.handleSameDayDrag(item, fromDate, fromKey, fromDay, newStart, newEnd, oldStart, oldEnd);
		} else {
			await this.handleCrossDayDrag(item, fromDate, fromKey, fromDay, toDate, toKey, toDay, newStart, newEnd, oldStart, oldEnd);
		}

		await this.ctx.refresh();
	}

	private async handleSameDayDrag(
		item: TimelineItem,
		fromDate: Moment,
		fromKey: string,
		fromDay: number,
		newStart: number,
		newEnd: number,
		oldStart: number,
		oldEnd: number
	): Promise<void> {
		const items = this.ctx.weekData.get(fromKey) || [];
		const idx = items.findIndex((i) => i.id === item.id);
		if (idx === -1) return;

		if (items[idx].checkbox === "actual") {
			const oldActualTime = items[idx].actualTime
				? { ...items[idx].actualTime! }
				: undefined;
			items[idx].actualTime = { start: newStart, end: newEnd };
			await this.ctx.guardedSave(fromDate, items);

			const action: UndoableAction = {
				description: "Move actual block",
				execute: async () => {},
				undo: async () => {
					const items = this.ctx.weekData.get(fromKey) || [];
					const idx = items.findIndex((i) => i.id === item.id);
					if (idx !== -1) {
						items[idx].actualTime = oldActualTime;
						await this.ctx.guardedSave(fromDate, items);
					}
				},
			};
			this.ctx.undoManager.pushExecuted(action);
		} else {
			items[idx].planTime = { start: newStart, end: newEnd };
			if (items[idx].actualTime) {
				const actDuration =
					items[idx].actualTime!.end - items[idx].actualTime!.start;
				items[idx].actualTime = {
					start: newStart,
					end: newStart + actDuration,
				};
			}

			const splitResult = this.splitOvernightItem(items[idx], fromDay);
			if (splitResult) {
				items[idx] = splitResult.today;
				await this.ctx.guardedSave(fromDate, items);

				const tomorrowItems = [
					...(this.ctx.weekData.get(splitResult.tomorrowKey) || []),
					splitResult.tomorrow,
				];
				this.ctx.weekData.set(splitResult.tomorrowKey, tomorrowItems);
				await this.ctx.guardedSave(
					this.ctx.dates[splitResult.tomorrowDayIndex],
					tomorrowItems
				);

				const action: UndoableAction = {
					description: "Move block (overnight split)",
					execute: async () => {},
					undo: async () => {
						const items = this.ctx.weekData.get(fromKey) || [];
						const idx = items.findIndex(
							(i) => i.id === splitResult.today.id
						);
						if (idx !== -1) {
							items[idx].planTime = { start: oldStart, end: oldEnd };
							items[idx].id = item.id;
							await this.ctx.guardedSave(fromDate, items);
						}
						const tmr =
							this.ctx.weekData.get(splitResult.tomorrowKey) || [];
						this.ctx.weekData.set(
							splitResult.tomorrowKey,
							tmr.filter((i) => i.id !== splitResult.tomorrow.id)
						);
						await this.ctx.guardedSave(
							this.ctx.dates[splitResult.tomorrowDayIndex],
							this.ctx.weekData.get(splitResult.tomorrowKey)!
						);
					},
				};
				this.ctx.undoManager.pushExecuted(action);
			} else {
				await this.ctx.guardedSave(fromDate, items);

				const action: UndoableAction = {
					description: "Move block",
					execute: async () => {},
					undo: async () => {
						const items = this.ctx.weekData.get(fromKey) || [];
						const idx = items.findIndex((i) => i.id === item.id);
						if (idx !== -1) {
							items[idx].planTime = { start: oldStart, end: oldEnd };
							if (items[idx].actualTime) {
								const actDuration =
									items[idx].actualTime!.end -
									items[idx].actualTime!.start;
								items[idx].actualTime = {
									start: oldStart,
									end: oldStart + actDuration,
								};
							}
							await this.ctx.guardedSave(fromDate, items);
						}
					},
				};
				this.ctx.undoManager.pushExecuted(action);
			}
		}
	}

	private async handleCrossDayDrag(
		item: TimelineItem,
		fromDate: Moment,
		fromKey: string,
		fromDay: number,
		toDate: Moment,
		toKey: string,
		toDay: number,
		newStart: number,
		newEnd: number,
		oldStart: number,
		oldEnd: number
	): Promise<void> {
		const today = window.moment().startOf("day");
		const isPastDay = fromDate.isBefore(today, "day");

		const fromItems = this.ctx.weekData.get(fromKey) || [];
		const movedItem = fromItems.find((i) => i.id === item.id);
		if (!movedItem) return;

		const oldCheckbox = movedItem.checkbox;

		if (isPastDay && movedItem.checkbox === "plan") {
			// Deferred logic: mark original as deferred, create new plan
			movedItem.checkbox = "deferred";
			await this.ctx.guardedSave(fromDate, fromItems);

			const newItem: TimelineItem = {
				id: generateItemId(),
				checkbox: "plan",
				planTime: { start: newStart, end: newEnd },
				content: movedItem.content,
				tags: [...movedItem.tags],
				rawSuffix: movedItem.rawSuffix,
			};

			const splitResult = this.splitOvernightItem(newItem, toDay);
			if (splitResult) {
				const toItems =
					this.ctx.weekData.get(splitResult.todayKey) || [];
				toItems.push(splitResult.today);
				this.ctx.weekData.set(splitResult.todayKey, toItems);
				await this.ctx.guardedSave(
					this.ctx.dates[splitResult.todayDayIndex],
					toItems
				);

				const tomorrowItems = [
					...(this.ctx.weekData.get(splitResult.tomorrowKey) || []),
					splitResult.tomorrow,
				];
				this.ctx.weekData.set(splitResult.tomorrowKey, tomorrowItems);
				await this.ctx.guardedSave(
					this.ctx.dates[splitResult.tomorrowDayIndex],
					tomorrowItems
				);

				const action: UndoableAction = {
					description: "Defer block (overnight split)",
					execute: async () => {},
					undo: async () => {
						const fi = this.ctx.weekData.get(fromKey) || [];
						const idx = fi.findIndex((i) => i.id === item.id);
						if (idx !== -1) {
							fi[idx].checkbox = oldCheckbox;
							await this.ctx.guardedSave(fromDate, fi);
						}
						const ti =
							this.ctx.weekData.get(splitResult.todayKey) || [];
						this.ctx.weekData.set(
							splitResult.todayKey,
							ti.filter((i) => i.id !== splitResult.today.id)
						);
						await this.ctx.guardedSave(
							this.ctx.dates[splitResult.todayDayIndex],
							this.ctx.weekData.get(splitResult.todayKey)!
						);
						const tmr =
							this.ctx.weekData.get(splitResult.tomorrowKey) || [];
						this.ctx.weekData.set(
							splitResult.tomorrowKey,
							tmr.filter((i) => i.id !== splitResult.tomorrow.id)
						);
						await this.ctx.guardedSave(
							this.ctx.dates[splitResult.tomorrowDayIndex],
							this.ctx.weekData.get(splitResult.tomorrowKey)!
						);
					},
				};
				this.ctx.undoManager.pushExecuted(action);
			} else {
				const toItems = this.ctx.weekData.get(toKey) || [];
				toItems.push(newItem);
				this.ctx.weekData.set(toKey, toItems);
				await this.ctx.guardedSave(toDate, toItems);

				const action: UndoableAction = {
					description: "Defer block to another day",
					execute: async () => {},
					undo: async () => {
						const fi = this.ctx.weekData.get(fromKey) || [];
						const idx = fi.findIndex((i) => i.id === item.id);
						if (idx !== -1) {
							fi[idx].checkbox = oldCheckbox;
							await this.ctx.guardedSave(fromDate, fi);
						}
						const ti = this.ctx.weekData.get(toKey) || [];
						this.ctx.weekData.set(
							toKey,
							ti.filter((i) => i.id !== newItem.id)
						);
						await this.ctx.guardedSave(
							toDate,
							this.ctx.weekData.get(toKey)!
						);
					},
				};
				this.ctx.undoManager.pushExecuted(action);
			}
		} else {
			// Simple move: remove from source, add to destination
			this.ctx.weekData.set(
				fromKey,
				fromItems.filter((i) => i.id !== item.id)
			);
			movedItem.planTime = { start: newStart, end: newEnd };
			if (movedItem.actualTime) {
				const actDuration =
					movedItem.actualTime.end - movedItem.actualTime.start;
				movedItem.actualTime = {
					start: newStart,
					end: newStart + actDuration,
				};
			}

			const splitResult = this.splitOvernightItem(movedItem, toDay);
			if (splitResult) {
				const toItems =
					this.ctx.weekData.get(splitResult.todayKey) || [];
				toItems.push(splitResult.today);
				this.ctx.weekData.set(splitResult.todayKey, toItems);

				const tomorrowItems = [
					...(this.ctx.weekData.get(splitResult.tomorrowKey) || []),
					splitResult.tomorrow,
				];
				this.ctx.weekData.set(splitResult.tomorrowKey, tomorrowItems);

				await this.ctx.guardedSave(
					fromDate,
					this.ctx.weekData.get(fromKey)!
				);
				await this.ctx.guardedSave(
					this.ctx.dates[splitResult.todayDayIndex],
					toItems
				);
				await this.ctx.guardedSave(
					this.ctx.dates[splitResult.tomorrowDayIndex],
					tomorrowItems
				);

				const action: UndoableAction = {
					description: "Move block (overnight split)",
					execute: async () => {},
					undo: async () => {
						const ti =
							this.ctx.weekData.get(splitResult.todayKey) || [];
						this.ctx.weekData.set(
							splitResult.todayKey,
							ti.filter((i) => i.id !== splitResult.today.id)
						);
						await this.ctx.guardedSave(
							this.ctx.dates[splitResult.todayDayIndex],
							this.ctx.weekData.get(splitResult.todayKey)!
						);

						const tmr =
							this.ctx.weekData.get(splitResult.tomorrowKey) || [];
						this.ctx.weekData.set(
							splitResult.tomorrowKey,
							tmr.filter((i) => i.id !== splitResult.tomorrow.id)
						);
						await this.ctx.guardedSave(
							this.ctx.dates[splitResult.tomorrowDayIndex],
							this.ctx.weekData.get(splitResult.tomorrowKey)!
						);

						movedItem.planTime = { start: oldStart, end: oldEnd };
						if (movedItem.actualTime) {
							const actDuration =
								movedItem.actualTime.end -
								movedItem.actualTime.start;
							movedItem.actualTime = {
								start: oldStart,
								end: oldStart + actDuration,
							};
						}

						const fromItems =
							this.ctx.weekData.get(fromKey) || [];
						fromItems.push(movedItem);
						this.ctx.weekData.set(fromKey, fromItems);
						await this.ctx.guardedSave(fromDate, fromItems);
					},
				};
				this.ctx.undoManager.pushExecuted(action);
			} else {
				const toItems = this.ctx.weekData.get(toKey) || [];
				toItems.push(movedItem);
				this.ctx.weekData.set(toKey, toItems);

				await this.ctx.guardedSave(
					fromDate,
					this.ctx.weekData.get(fromKey)!
				);
				await this.ctx.guardedSave(toDate, toItems);

				const action: UndoableAction = {
					description: "Move block to another day",
					execute: async () => {},
					undo: async () => {
						const toItems =
							this.ctx.weekData.get(toKey) || [];
						const itemBack = toItems.find(
							(i) => i.id === item.id
						);
						if (!itemBack) return;

						this.ctx.weekData.set(
							toKey,
							toItems.filter((i) => i.id !== item.id)
						);
						itemBack.planTime = { start: oldStart, end: oldEnd };
						if (itemBack.actualTime) {
							const actDuration =
								itemBack.actualTime.end -
								itemBack.actualTime.start;
							itemBack.actualTime = {
								start: oldStart,
								end: oldStart + actDuration,
							};
						}

						const fromItems =
							this.ctx.weekData.get(fromKey) || [];
						fromItems.push(itemBack);
						this.ctx.weekData.set(fromKey, fromItems);

						await this.ctx.guardedSave(
							toDate,
							this.ctx.weekData.get(toKey)!
						);
						await this.ctx.guardedSave(fromDate, fromItems);
					},
				};
				this.ctx.undoManager.pushExecuted(action);
			}
		}
	}

	// ── Block resize ────────────────────────────────────────────────

	async onBlockResize(
		item: TimelineItem,
		dayIndex: number,
		newStart: number,
		newEnd: number
	): Promise<void> {
		const date = this.ctx.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const items = this.ctx.weekData.get(dateKey) || [];
		const idx = items.findIndex((i) => i.id === item.id);
		if (idx === -1) return;

		if (items[idx].checkbox === "actual") {
			const oldActualTime = items[idx].actualTime
				? { ...items[idx].actualTime! }
				: undefined;
			items[idx].actualTime = { start: newStart, end: newEnd };
			await this.ctx.guardedSave(date, items);

			const action: UndoableAction = {
				description: "Resize actual block",
				execute: async () => {},
				undo: async () => {
					const items = this.ctx.weekData.get(dateKey) || [];
					const idx = items.findIndex((i) => i.id === item.id);
					if (idx !== -1) {
						items[idx].actualTime = oldActualTime;
						await this.ctx.guardedSave(date, items);
					}
				},
			};
			this.ctx.undoManager.pushExecuted(action);
		} else {
			const oldStart = items[idx].planTime.start;
			const oldEnd = items[idx].planTime.end;
			items[idx].planTime = { start: newStart, end: newEnd };
			await this.ctx.guardedSave(date, items);

			const action: UndoableAction = {
				description: "Resize block",
				execute: async () => {},
				undo: async () => {
					const items = this.ctx.weekData.get(dateKey) || [];
					const idx = items.findIndex((i) => i.id === item.id);
					if (idx !== -1) {
						items[idx].planTime = { start: oldStart, end: oldEnd };
						await this.ctx.guardedSave(date, items);
					}
				},
			};
			this.ctx.undoManager.pushExecuted(action);
		}

		await this.ctx.refresh();
	}

	// ── Block complete / uncomplete ─────────────────────────────────

	async onBlockComplete(
		dayIndex: number,
		item: TimelineItem
	): Promise<void> {
		const date = this.ctx.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const items = this.ctx.weekData.get(dateKey) || [];
		const idx = items.findIndex((i) => i.id === item.id);
		if (idx === -1) return;

		const oldCheckbox = items[idx].checkbox;
		items[idx].checkbox = "actual";
		await this.ctx.guardedSave(date, items);

		const action: UndoableAction = {
			description: "Complete block",
			execute: async () => {},
			undo: async () => {
				const items = this.ctx.weekData.get(dateKey) || [];
				const idx = items.findIndex((i) => i.id === item.id);
				if (idx !== -1) {
					items[idx].checkbox = oldCheckbox;
					await this.ctx.guardedSave(date, items);
				}
			},
		};
		this.ctx.undoManager.pushExecuted(action);

		// If this block references a project task, offer to complete it too
		const linkMatch = item.content.match(
			/\[\[([^#\]]+)#\^([a-zA-Z0-9-]+)\]\]/
		);
		if (linkMatch) {
			const projectNoteName = linkMatch[1];
			const blockId = linkMatch[2];
			const projectFile = this.ctx.app.vault
				.getMarkdownFiles()
				.find((f) => f.basename === projectNoteName);
			if (projectFile) {
				new ConfirmModal(
					this.ctx.app,
					"Mark the original project task as complete too?",
					async () => {
						await this.ctx.withSelfWriteGuard(() =>
							completeProjectTask(
								this.ctx.app.vault,
								projectFile.path,
								blockId
							)
						);
					}
				).open();
			}
		}

		await this.ctx.refresh();
	}

	async onBlockUncomplete(
		dayIndex: number,
		item: TimelineItem
	): Promise<void> {
		const date = this.ctx.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const items = this.ctx.weekData.get(dateKey) || [];
		const idx = items.findIndex((i) => i.id === item.id);
		if (idx === -1) return;

		const oldCheckbox = items[idx].checkbox;
		const oldActualTime = items[idx].actualTime
			? { ...items[idx].actualTime! }
			: undefined;

		items[idx].checkbox = "plan";
		items[idx].actualTime = undefined;
		await this.ctx.guardedSave(date, items);

		const action: UndoableAction = {
			description: "Uncomplete block",
			execute: async () => {},
			undo: async () => {
				const items = this.ctx.weekData.get(dateKey) || [];
				const idx = items.findIndex((i) => i.id === item.id);
				if (idx !== -1) {
					items[idx].checkbox = oldCheckbox;
					items[idx].actualTime = oldActualTime;
					await this.ctx.guardedSave(date, items);
				}
			},
		};
		this.ctx.undoManager.pushExecuted(action);

		await this.ctx.refresh();
	}

	// ── Delete block ────────────────────────────────────────────────

	async deleteBlock(
		dayIndex: number,
		item: TimelineItem
	): Promise<void> {
		const date = this.ctx.dates[dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const items = this.ctx.weekData.get(dateKey) || [];

		const oldItem = {
			...item,
			planTime: { ...item.planTime },
			actualTime: item.actualTime
				? { ...item.actualTime }
				: undefined,
			tags: [...item.tags],
		};

		this.ctx.weekData.set(
			dateKey,
			items.filter((i) => i.id !== item.id)
		);
		await this.ctx.guardedSave(date, this.ctx.weekData.get(dateKey)!);

		const action: UndoableAction = {
			description: "Delete block",
			execute: async () => {},
			undo: async () => {
				const items = this.ctx.weekData.get(dateKey) || [];
				items.push(oldItem);
				this.ctx.weekData.set(dateKey, items);
				await this.ctx.guardedSave(date, items);
			},
		};
		this.ctx.undoManager.pushExecuted(action);

		await this.ctx.refresh();
	}

	// ── Compact sort ────────────────────────────────────────────────

	async sortBlocksCompact(): Promise<void> {
		const dayStartMinutes = this.ctx.settings.dayStartHour * 60;

		// Snapshot old state for undo
		const oldWeekData = new Map<string, TimelineItem[]>();
		for (const [key, items] of this.ctx.weekData) {
			oldWeekData.set(
				key,
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

		for (let d = 0; d < 7; d++) {
			const dateKey = this.ctx.dates[d].format("YYYY-MM-DD");
			const items = this.ctx.weekData.get(dateKey) || [];

			const plans = items
				.filter((i) => i.checkbox === "plan")
				.sort((a, b) => a.planTime.start - b.planTime.start);
			const others = items.filter((i) => i.checkbox !== "plan");

			let cursor = dayStartMinutes;
			for (const item of plans) {
				const duration = item.planTime.end - item.planTime.start;
				item.planTime = { start: cursor, end: cursor + duration };
				cursor += duration;
			}

			this.ctx.weekData.set(dateKey, [...plans, ...others]);
			await this.ctx.guardedSave(
				this.ctx.dates[d],
				this.ctx.weekData.get(dateKey)!
			);
		}

		const action: UndoableAction = {
			description: "Compact plan blocks",
			execute: async () => {},
			undo: async () => {
				for (let d = 0; d < 7; d++) {
					const dateKey = this.ctx.dates[d].format("YYYY-MM-DD");
					const oldItems = oldWeekData.get(dateKey) || [];
					this.ctx.weekData.set(dateKey, oldItems);
					await this.ctx.guardedSave(this.ctx.dates[d], oldItems);
				}
			},
		};
		this.ctx.undoManager.pushExecuted(action);

		await this.ctx.refresh();
	}

	// ── Inbox helpers ───────────────────────────────────────────────

	async removeFromInbox(
		filePath: string,
		lineNumber: number
	): Promise<void> {
		await this.ctx.withSelfWriteGuard(() =>
			removeFromInboxFile(this.ctx.app.vault, filePath, lineNumber)
		);
	}

	// ── Return block to inbox ───────────────────────────────────────

	async onBlockReturnToInbox(
		item: TimelineItem,
		fromDay: number
	): Promise<void> {
		const fromDate = this.ctx.dates[fromDay];
		const fromKey = fromDate.format("YYYY-MM-DD");
		const today = window.moment().startOf("day");

		const inboxLine = serializeCheckboxItem(
			item.content,
			item.tags,
			item.rawSuffix
		);

		await this.ctx.withSelfWriteGuard(() =>
			addToInbox(this.ctx.app.vault, this.ctx.settings, inboxLine)
		);

		const freshInbox = await getInboxItems(
			this.ctx.app.vault,
			this.ctx.settings
		);
		const addedItem = freshInbox.find(
			(i) =>
				serializeCheckboxItem(i.content, i.tags, i.rawSuffix) ===
				inboxLine
		);
		const addedPath = addedItem?.sourcePath;
		const addedLine = addedItem?.lineNumber;

		const fromItems = this.ctx.weekData.get(fromKey) || [];
		const oldCheckbox = item.checkbox;

		if (fromDate.isBefore(today, "day")) {
			const idx = fromItems.findIndex((i) => i.id === item.id);
			if (idx !== -1) {
				fromItems[idx].checkbox = "deferred";
				await this.ctx.guardedSave(fromDate, fromItems);
			}
		} else {
			this.ctx.weekData.set(
				fromKey,
				fromItems.filter((i) => i.id !== item.id)
			);
			await this.ctx.guardedSave(
				fromDate,
				this.ctx.weekData.get(fromKey)!
			);
		}

		const action: UndoableAction = {
			description: "Return block to inbox",
			execute: async () => {},
			undo: async () => {
				if (addedPath != null && addedLine != null) {
					await this.ctx.withSelfWriteGuard(() =>
						removeFromInboxFile(
							this.ctx.app.vault,
							addedPath,
							addedLine
						)
					);
				}
				const fi = this.ctx.weekData.get(fromKey) || [];
				if (fromDate.isBefore(today, "day")) {
					const idx = fi.findIndex((i) => i.id === item.id);
					if (idx !== -1) {
						fi[idx].checkbox = oldCheckbox;
						await this.ctx.guardedSave(fromDate, fi);
					}
				} else {
					item.checkbox = oldCheckbox;
					fi.push(item);
					this.ctx.weekData.set(fromKey, fi);
					await this.ctx.guardedSave(fromDate, fi);
				}
			},
		};
		this.ctx.undoManager.pushExecuted(action);

		await this.ctx.refresh();
	}

	// ── Panel → grid drop ───────────────────────────────────────────

	async onPanelDragEnd(
		item: PanelItem,
		cell: { dayIndex: number; minutes: number }
	): Promise<void> {
		const src = item.source;
		const duration =
			src.type === "overdue"
				? src.planTime.end - src.planTime.start
				: this.ctx.settings.defaultBlockDuration;
		const snappedStart = Math.round(cell.minutes / 10) * 10;
		const snappedEnd = snappedStart + duration;

		const date = this.ctx.dates[cell.dayIndex];
		const dateKey = date.format("YYYY-MM-DD");
		const today = window.moment().startOf("day");
		const isPast = date.isBefore(today, "day");

		let contentForTimeline = item.content;
		if (src.type === "project") {
			let blockId = src.blockId;
			if (!blockId) {
				blockId = generateBlockId();
				const pd = this.ctx.projectData.find(
					(d) => d.project.path === src.projectPath
				);
				if (pd) {
					const taskIdx = pd.tasks.findIndex(
						(t) => t.content === item.content
					);
					if (taskIdx !== -1) {
						await this.ctx.withSelfWriteGuard(() =>
							appendBlockIdToLine(
								this.ctx.app.vault,
								src.projectPath,
								pd.tasks[taskIdx].lineNumber,
								blockId!
							)
						);
					}
				}
			}
			const projectFile = this.ctx.app.vault.getAbstractFileByPath(
				src.projectPath
			);
			const projectName = projectFile
				? projectFile.name.replace(/\.md$/, "")
				: src.projectPath.replace(/\.md$/, "");
			contentForTimeline = `${item.content} [[${projectName}#^${blockId}]]`;
		}

		const finalEnd =
			cell.dayIndex >= 6 ? Math.min(snappedEnd, 1440) : snappedEnd;
		const newItem: TimelineItem = {
			id: generateItemId(),
			checkbox: isPast ? "actual" : "plan",
			planTime: { start: snappedStart, end: finalEnd },
			content: contentForTimeline,
			tags: [...item.tags],
			rawSuffix: item.rawSuffix,
		};

		const splitResult = this.splitOvernightItem(newItem, cell.dayIndex);
		if (splitResult) {
			await this.handlePanelDragWithSplit(
				item,
				src,
				date,
				dateKey,
				newItem,
				splitResult
			);
		} else {
			await this.handlePanelDragNoSplit(
				item,
				src,
				date,
				dateKey,
				newItem
			);
		}

		await this.ctx.refresh();
	}

	private async handlePanelDragWithSplit(
		item: PanelItem,
		src: PanelItem["source"],
		date: Moment,
		dateKey: string,
		newItem: TimelineItem,
		splitResult: NonNullable<ReturnType<BlockActions["splitOvernightItem"]>>
	): Promise<void> {
		const todayItems = [
			...(this.ctx.weekData.get(splitResult.todayKey) || []),
			splitResult.today,
		];
		this.ctx.weekData.set(splitResult.todayKey, todayItems);
		await this.ctx.guardedSave(
			this.ctx.dates[splitResult.todayDayIndex],
			todayItems
		);

		const tomorrowItems = [
			...(this.ctx.weekData.get(splitResult.tomorrowKey) || []),
			splitResult.tomorrow,
		];
		this.ctx.weekData.set(splitResult.tomorrowKey, tomorrowItems);
		await this.ctx.guardedSave(
			this.ctx.dates[splitResult.tomorrowDayIndex],
			tomorrowItems
		);

		const undoSplitItems = async () => {
			const ti =
				this.ctx.weekData.get(splitResult.todayKey) || [];
			this.ctx.weekData.set(
				splitResult.todayKey,
				ti.filter((i) => i.id !== splitResult.today.id)
			);
			await this.ctx.guardedSave(
				this.ctx.dates[splitResult.todayDayIndex],
				this.ctx.weekData.get(splitResult.todayKey)!
			);

			const tmr =
				this.ctx.weekData.get(splitResult.tomorrowKey) || [];
			this.ctx.weekData.set(
				splitResult.tomorrowKey,
				tmr.filter((i) => i.id !== splitResult.tomorrow.id)
			);
			await this.ctx.guardedSave(
				this.ctx.dates[splitResult.tomorrowDayIndex],
				this.ctx.weekData.get(splitResult.tomorrowKey)!
			);
		};

		if (src.type === "overdue") {
			const origDate = this.ctx.dates.find(
				(d) => d.format("YYYY-MM-DD") === src.dateKey
			);
			if (origDate) {
				const origItems =
					this.ctx.weekData.get(src.dateKey) || [];
				const origIdx = origItems.findIndex(
					(i) => i.id === src.originalId
				);
				if (origIdx !== -1) {
					const oldCheckbox = origItems[origIdx].checkbox;
					origItems[origIdx].checkbox = "deferred";
					await this.ctx.guardedSave(origDate, origItems);

					const action: UndoableAction = {
						description:
							"Schedule overdue item (overnight split)",
						execute: async () => {},
						undo: async () => {
							const oi =
								this.ctx.weekData.get(src.dateKey) || [];
							const idx = oi.findIndex(
								(i) => i.id === src.originalId
							);
							if (idx !== -1) {
								oi[idx].checkbox = oldCheckbox;
								await this.ctx.guardedSave(origDate!, oi);
							}
							await undoSplitItems();
						},
					};
					this.ctx.undoManager.pushExecuted(action);
				}
			}
		} else if (src.type === "inbox") {
			const inboxLine = serializeCheckboxItem(
				item.content,
				item.tags,
				item.rawSuffix
			);
			await this.removeFromInbox(src.notePath, src.lineNumber);

			const action: UndoableAction = {
				description: "Schedule inbox item (overnight split)",
				execute: async () => {},
				undo: async () => {
					await undoSplitItems();
					await addToInbox(
						this.ctx.app.vault,
						this.ctx.settings,
						inboxLine
					);
				},
			};
			this.ctx.undoManager.pushExecuted(action);
		} else {
			const action: UndoableAction = {
				description: "Schedule project task (overnight split)",
				execute: async () => {},
				undo: undoSplitItems,
			};
			this.ctx.undoManager.pushExecuted(action);
		}
	}

	private async handlePanelDragNoSplit(
		item: PanelItem,
		src: PanelItem["source"],
		date: Moment,
		dateKey: string,
		newItem: TimelineItem
	): Promise<void> {
		const existing = this.ctx.weekData.get(dateKey) || [];
		existing.push(newItem);
		this.ctx.weekData.set(dateKey, existing);
		await this.ctx.guardedSave(date, existing);

		if (src.type === "overdue") {
			const origDate = this.ctx.dates.find(
				(d) => d.format("YYYY-MM-DD") === src.dateKey
			);
			if (origDate) {
				const origItems =
					this.ctx.weekData.get(src.dateKey) || [];
				const origIdx = origItems.findIndex(
					(i) => i.id === src.originalId
				);
				if (origIdx !== -1) {
					const oldCheckbox = origItems[origIdx].checkbox;
					origItems[origIdx].checkbox = "deferred";
					await this.ctx.guardedSave(origDate, origItems);

					const action: UndoableAction = {
						description: "Schedule overdue item",
						execute: async () => {},
						undo: async () => {
							const oi =
								this.ctx.weekData.get(src.dateKey) || [];
							const idx = oi.findIndex(
								(i) => i.id === src.originalId
							);
							if (idx !== -1) {
								oi[idx].checkbox = oldCheckbox;
								await this.ctx.guardedSave(origDate!, oi);
							}
							const ni =
								this.ctx.weekData.get(dateKey) || [];
							this.ctx.weekData.set(
								dateKey,
								ni.filter((i) => i.id !== newItem.id)
							);
							await this.ctx.guardedSave(
								date,
								this.ctx.weekData.get(dateKey)!
							);
						},
					};
					this.ctx.undoManager.pushExecuted(action);
				}
			}
		} else if (src.type === "inbox") {
			const inboxLine = serializeCheckboxItem(
				item.content,
				item.tags,
				item.rawSuffix
			);
			await this.removeFromInbox(src.notePath, src.lineNumber);

			const action: UndoableAction = {
				description: "Schedule inbox item",
				execute: async () => {},
				undo: async () => {
					const ni = this.ctx.weekData.get(dateKey) || [];
					this.ctx.weekData.set(
						dateKey,
						ni.filter((i) => i.id !== newItem.id)
					);
					await this.ctx.guardedSave(
						date,
						this.ctx.weekData.get(dateKey)!
					);
					await addToInbox(
						this.ctx.app.vault,
						this.ctx.settings,
						inboxLine
					);
				},
			};
			this.ctx.undoManager.pushExecuted(action);
		} else {
			const action: UndoableAction = {
				description: "Schedule project task",
				execute: async () => {},
				undo: async () => {
					const ni = this.ctx.weekData.get(dateKey) || [];
					this.ctx.weekData.set(
						dateKey,
						ni.filter((i) => i.id !== newItem.id)
					);
					await this.ctx.guardedSave(
						date,
						this.ctx.weekData.get(dateKey)!
					);
				},
			};
			this.ctx.undoManager.pushExecuted(action);
		}
	}
}
