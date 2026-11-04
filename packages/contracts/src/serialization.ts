import { z } from "zod";

/**
 * Preserve native JSON.stringify behavior, including exceptions and undefined.
 * Its TypeScript lib return type omits the possible undefined result.
 */
export const jsonSerializationSchema = z
	.unknown()
	.transform((value) => JSON.stringify(value));
export type JsonSerialization = z.infer<typeof jsonSerializationSchema>;

/** MCP text results retain native serialization semantics with two-space indentation. */
export const prettyJsonSerializationSchema = z
	.unknown()
	.transform((value) => JSON.stringify(value, null, 2));
export type PrettyJsonSerialization = z.infer<
	typeof prettyJsonSerializationSchema
>;

/** Thrown strings are messages, not JSON string literals. */
export const thrownStringSchema = z.string();
export type ThrownString = z.infer<typeof thrownStringSchema>;
