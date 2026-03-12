import { isMobileDevice } from "./device";

/**
 * On mobile, adjust a modal's max-height when the virtual keyboard appears
 * so that the content remains scrollable and the focused input stays visible.
 *
 * Returns a cleanup function to remove listeners, or null on non-mobile.
 */
export function setupModalKeyboardAvoidance(modalEl: HTMLElement): (() => void) | null {
	if (!isMobileDevice()) return null;

	const vv = window.visualViewport;
	if (!vv) return null;

	const onViewportResize = () => {
		const focused = modalEl.querySelector(":focus") as HTMLElement | null;
		if (!focused || !(focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) {
			modalEl.style.maxHeight = "";
			modalEl.style.overflowY = "";
			return;
		}

		const keyboardTop = vv.offsetTop + vv.height;
		const modalRect = modalEl.getBoundingClientRect();
		const availableHeight = keyboardTop - modalRect.top;

		if (availableHeight > 0) {
			modalEl.style.maxHeight = `${availableHeight}px`;
			modalEl.style.overflowY = "auto";
		}

		requestAnimationFrame(() => {
			focused.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
	};

	const onFocusIn = () => {
		vv.addEventListener("resize", onViewportResize);
		setTimeout(onViewportResize, 100);
	};

	const onFocusOut = () => {
		setTimeout(() => {
			if (!modalEl.querySelector(":focus")) {
				modalEl.style.maxHeight = "";
				modalEl.style.overflowY = "";
				vv.removeEventListener("resize", onViewportResize);
			}
		}, 100);
	};

	modalEl.addEventListener("focusin", onFocusIn);
	modalEl.addEventListener("focusout", onFocusOut);

	return () => {
		modalEl.removeEventListener("focusin", onFocusIn);
		modalEl.removeEventListener("focusout", onFocusOut);
		vv.removeEventListener("resize", onViewportResize);
		modalEl.style.maxHeight = "";
		modalEl.style.overflowY = "";
	};
}
