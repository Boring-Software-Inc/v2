import {
	jsonSerializationSchema,
	thrownStringSchema,
} from "@tripwire/contracts";

/** Coerces an unknown thrown value into a real Error. */
export function toError(cause: unknown): Error {
	if (cause instanceof Error) {
		return cause;
	}
	const message = thrownStringSchema.safeParse(cause);
	if (message.success) {
		return new Error(message.data);
	}
	try {
		return new Error(jsonSerializationSchema.parse(cause));
	} catch {
		return new Error(String(cause));
	}
}

/** Extracts a human-readable message from an unknown thrown value. */
export function getErrorMessage(cause: unknown): string {
	return toError(cause).message;
}
