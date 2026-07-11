/** Truncates to `max` characters, appending an ellipsis when cut. */
export function truncate(value: string, max: number): string {
	if (value.length <= max) {
		return value;
	}
	return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
