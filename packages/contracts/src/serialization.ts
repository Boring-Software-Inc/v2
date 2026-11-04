import { z } from "zod";
import { type JsonValue, jsonValueSchema } from "./workflow.ts";

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

const storedJsonContainerSchema = z.union([
	z.array(z.unknown()),
	z.record(z.string(), z.unknown()),
]);

type StoredJsonFrame =
	| { phase: "enter"; value: Parameters<typeof jsonValueSchema.safeParse>[0] }
	| { phase: "leave"; value: object };

/** An explicit stack rejects cycles without swallowing getters or cloning stored keys. */
export const storedJsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(
	(value) => {
		const ancestors = new WeakSet<object>();
		const pending: StoredJsonFrame[] = [{ phase: "enter", value }];
		while (pending.length > 0) {
			const frame = pending.pop();
			if (!frame) break;
			if (frame.phase === "leave") {
				ancestors.delete(frame.value);
				continue;
			}
			const container = storedJsonContainerSchema.safeParse(frame.value);
			if (!container.success) {
				if (!jsonValueSchema.safeParse(frame.value).success) return false;
				continue;
			}
			const identity: object = Object(frame.value);
			if (ancestors.has(identity)) return false;
			ancestors.add(identity);
			pending.push({ phase: "leave", value: identity });
			const fields = Array.isArray(container.data)
				? container.data
				: Object.values(identity);
			for (let index = fields.length - 1; index >= 0; index--) {
				pending.push({ phase: "enter", value: fields[index] });
			}
		}
		return true;
	},
	{ error: "Stored value must be JSON" },
);
export type StoredJsonValue = z.infer<typeof storedJsonValueSchema>;
