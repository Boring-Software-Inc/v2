import {
	SHARED_BLOCKLIST_RULE_ID,
	sharedBlocklistMatchSchema,
} from "@tripwire/contracts";
import { defineRule } from "./define.ts";

/** Evidence pins the matched account, public reason, and source snapshot revision. */
export const sharedSpamBlocklist = defineRule({
	id: SHARED_BLOCKLIST_RULE_ID,
	version: 1,
	configSchema: sharedBlocklistMatchSchema,
	resultSchema: sharedBlocklistMatchSchema,
	evaluate(ctx, match) {
		if (
			ctx.event.forge !== "github" ||
			ctx.event.kind !== "change-request.opened" ||
			ctx.event.actor.externalId !== match.accountId
		) {
			return {
				status: "skipped",
				reason: "No verified match for this author.",
			};
		}
		return { status: "evaluated", passed: false, evidence: match };
	},
	publicEvidence: () => ({}),
	summarize: () => "This pull request was sent to a maintainer for review.",
	remedy: "appeal",
});
