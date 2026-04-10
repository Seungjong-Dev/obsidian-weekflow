/**
 * Standardized CLI response format for all WeekFlow CLI handlers.
 * All responses are JSON strings for programmatic consumption by external agents.
 */

export interface CliResponse<T = unknown> {
	ok: boolean;
	command: string;
	data?: T;
	error?: string;
}

export function ok<T>(command: string, data: T): string {
	return JSON.stringify({ ok: true, command, data } satisfies CliResponse<T>);
}

export function err(command: string, error: string): string {
	return JSON.stringify({ ok: false, command, error } satisfies CliResponse);
}

/** Validate that all required flags are present. Returns error message or null. */
export function validateRequired(
	params: Record<string, string | "true">,
	required: string[]
): string | null {
	const missing = required.filter((f) => !(f in params));
	if (missing.length > 0) {
		return `Missing required flag(s): ${missing.join(", ")}`;
	}
	return null;
}
