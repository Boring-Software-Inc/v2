import { z } from "zod";

const fileResult = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), value: z.string() }),
	z.object({
		ok: z.literal(false),
		reason: z.string().min(1).max(128),
		status: z.number().int().min(100).max(599).optional(),
	}),
]);

/** Native adapters retain strings; bounded refusals carry unavailable evidence to the AI tool. */
export const forgeFileReadResultSchema = z.union([
	z.string().transform((value) => ({ ok: true as const, value })),
	z.null().transform(() => ({ ok: false as const, reason: "unavailable" })),
	fileResult,
]);
export type ForgeFileReadResult = z.infer<typeof forgeFileReadResultSchema>;
