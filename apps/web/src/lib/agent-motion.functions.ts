import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";

export const setAgentMotion = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { reduce: boolean }) => ({
		reduce: z.boolean().parse(input.reduce),
	}))
	.handler(async ({ data }): Promise<{ reduce: boolean }> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			throw new Error("Your session ended. Sign in again to continue.");
		}
		const { getDb } = await import("#/lib/server/db");
		const { accountServices } = await import("@tripwire/db");
		await accountServices.setUserReduceAgentMotion(getDb().db, {
			userId,
			reduce: data.reduce,
		});
		return { reduce: data.reduce };
	});
