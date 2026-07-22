import { accountAgeConfigSchema } from "@tripwire/contracts";
import { atLeast, evaluateSignalRule } from "@tripwire/sdk";
import { z } from "zod";
import { readContextSignal, rule, signals } from "./context-forge.ts";
import { defineRule } from "./define.ts";

/**
 * account-age@1 — the contributor's forge account must be at least
 * `minDays` old. Evidence: the actual age vs the requirement. Authored as an
 * SDK signal rule over contributor.accountAge; the verdict is unchanged.
 */
export const accountAge = defineRule({
	id: "account-age",
	version: 1,
	configSchema: accountAgeConfigSchema,
	resultSchema: z.object({
		accountAgeDays: z.number(),
		minDays: z.number(),
	}),
	async evaluate(ctx, config) {
		const read = await readContextSignal("contributor.accountAge", ctx);
		if (!read.ok) {
			return { status: "skipped", reason: read.reason };
		}
		const requirement = rule("account age", {
			when: signals.contributor.accountAge,
			comparison: atLeast(config.minDays),
			severity: "medium",
		});
		const { passed } = evaluateSignalRule(requirement, {
			value: read.value,
			now: ctx.now,
		});
		return {
			status: "evaluated",
			passed,
			evidence: { accountAgeDays: read.value, minDays: config.minDays },
		};
	},
	publicEvidence: (e) => ({ accountAgeDays: e.accountAgeDays }),
	summarize: (e) => `your account is ${e.accountAgeDays} days old`,
	remedy: "wait",
	// Derived remainder only — the age needed never appears, just how much is left.
	waitHint: (e) => {
		const remaining = e.minDays - e.accountAgeDays;
		return remaining > 0
			? `it clears in ${remaining} ${remaining === 1 ? "day" : "days"}`
			: null;
	},
});
