export interface UndoableAction {
	execute(): Promise<void>;
	undo(): Promise<void>;
	description: string;
}

const MAX_STACK_SIZE = 50;

export class UndoManager {
	private undoStack: UndoableAction[] = [];
	private redoStack: UndoableAction[] = [];

	/**
	 * Execute an action and push it onto the undo stack.
	 */
	async perform(action: UndoableAction): Promise<void> {
		await action.execute();
		this.undoStack.push(action);
		if (this.undoStack.length > MAX_STACK_SIZE) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	/**
	 * Push an already-executed action onto the undo stack.
	 * Use this when the action was already performed inline.
	 */
	pushExecuted(action: UndoableAction): void {
		this.undoStack.push(action);
		if (this.undoStack.length > MAX_STACK_SIZE) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	async undo(): Promise<void> {
		const action = this.undoStack.pop();
		if (!action) return;
		await action.undo();
		this.redoStack.push(action);
	}

	async redo(): Promise<void> {
		const action = this.redoStack.pop();
		if (!action) return;
		await action.execute();
		this.undoStack.push(action);
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}
}
