import { z } from "zod";

/**
 * Preserve native JSON.stringify behavior, including exceptions and undefined.
 * Its TypeScript lib return type omits the possible undefined result.
 */
export const jsonSerializationSchema = z
	.unknown()
	.transform((value) => JSON.stringify(value));
export type JsonSerialization = z.infer<typeof jsonSerializationSchema>;

/** Thrown strings are messages, not JSON string literals. */
export const thrownStringSchema = z.string();
export type ThrownString = z.infer<typeof thrownStringSchema>;
