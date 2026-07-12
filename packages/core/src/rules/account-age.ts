import { accountAgeConfigSchema } from "@tripwire/contracts";
import { z } from "zod";
import { defineRule } from "./define.ts";

const DAY_MS = 86_400_000;

/**
 * account-age@1 — the contributor's forge account must be at least
 * `minDays` old. Evidence: the actual age vs the requirement.
 */
export const accountAge = defineRule({
	id: "account-age",
	version: 1,
	configSchema: accountAgeConfigSchema,
	resultSchema: z.object({
		accountAgeDays: z.number(),
		minDays: z.number(),
	}),
	evaluate(ctx, config) {
		if (ctx.contributor === null) {
			return { status: "skipped", reason: "contributor profile unavailable" };
		}
		const created = Date.parse(ctx.contributor.createdAt);
		if (Number.isNaN(created)) {
			return { status: "skipped", reason: "contributor createdAt unparseable" };
		}
		const accountAgeDays = Math.floor((Date.parse(ctx.now) - created) / DAY_MS);
		return {
			status: "evaluated",
			passed: accountAgeDays >= config.minDays,
			evidence: { accountAgeDays, minDays: config.minDays },
		};
	},
	publicEvidence: (e) => ({ accountAgeDays: e.accountAgeDays }),
	summarize: (e) => `this account is ${e.accountAgeDays} days old`,
	remedy: "wait",
	// Derived remainder only — the age needed never appears, just how much is left.
	waitHint: (e) => {
		const remaining = e.minDays - e.accountAgeDays;
		return remaining > 0
			? `it clears in ${remaining} ${remaining === 1 ? "day" : "days"}`
			: null;
	},
});
