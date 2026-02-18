export type DeviceTier = "desktop" | "tablet" | "phone";
export type LayoutTier = "wide" | "medium" | "narrow";

/**
 * Detect device tier from Obsidian body classes.
 * Obsidian adds `.is-mobile` and `.is-tablet` to document.body.
 */
export function getDeviceTier(): DeviceTier {
	if (document.body.classList.contains("is-tablet")) return "tablet";
	if (document.body.classList.contains("is-mobile")) return "phone";
	return "desktop";
}

export function isMobileDevice(): boolean {
	return document.body.classList.contains("is-mobile") || document.body.classList.contains("is-tablet");
}

/**
 * Layout tier based on available view width (not device type).
 * This is the primary decision driver for responsive behavior.
 */
export function getLayoutTier(viewWidth: number): LayoutTier {
	if (viewWidth >= 900) return "wide";
	if (viewWidth >= 500) return "medium";
	return "narrow";
}

/**
 * Map layout tier to number of visible days in the grid.
 */
export function getVisibleDays(tier: LayoutTier): 1 | 3 | 7 {
	if (tier === "wide") return 7;
	if (tier === "medium") return 3;
	return 1;
}

/**
 * Detect touch-capable device via Pointer Events API or touch events.
 */
export function isTouchDevice(): boolean {
	return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Trigger short haptic feedback on supported devices.
 */
export function hapticFeedback(): void {
	if (navigator.vibrate) navigator.vibrate(10);
}
