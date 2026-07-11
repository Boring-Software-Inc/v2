/** Coerces an unknown thrown value into a real Error. */
export function toError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	if (typeof value === "string") {
		return new Error(value);
	}
	try {
		return new Error(JSON.stringify(value));
	} catch {
		return new Error(String(value));
	}
}

/** Extracts a human-readable message from an unknown thrown value. */
export function getErrorMessage(value: unknown): string {
	return toError(value).message;
}
