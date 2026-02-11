import { Modal, type App } from "obsidian";

export class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;
	private onCancel: () => void;

	constructor(
		app: App,
		message: string,
		onConfirm: () => void,
		onCancel?: () => void
	) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel || (() => {});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("p", { text: this.message });

		const btnContainer = contentEl.createDiv({
			cls: "weekflow-confirm-buttons",
		});
		btnContainer.style.display = "flex";
		btnContainer.style.justifyContent = "flex-end";
		btnContainer.style.gap = "8px";
		btnContainer.style.marginTop = "16px";

		const cancelBtn = btnContainer.createEl("button", { text: "No" });
		cancelBtn.addEventListener("click", () => {
			this.onCancel();
			this.close();
		});

		const confirmBtn = btnContainer.createEl("button", {
			text: "Yes",
			cls: "mod-cta",
		});
		confirmBtn.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
