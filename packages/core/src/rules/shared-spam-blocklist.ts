import {
	PILOT_TRIGGER_KINDS,
	SHARED_BLOCKLIST_RULE_ID,
	SHARED_BLOCKLIST_RULE_VERSION,
	sharedBlocklistEvidenceSchema,
	sharedBlocklistMatchSchema,
	sharedBlocklistRuleConfigSchema,
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

export const sharedSpamBlocklistV2 = defineRule({
	id: SHARED_BLOCKLIST_RULE_ID,
	version: SHARED_BLOCKLIST_RULE_VERSION,
	configSchema: sharedBlocklistRuleConfigSchema,
	resultSchema: sharedBlocklistEvidenceSchema,
	evaluate(ctx) {
		if (
			ctx.event.forge !== "github" ||
			!PILOT_TRIGGER_KINDS.includes(ctx.event.kind)
		) {
			return {
				status: "skipped",
				reason: "Pilot checks newly opened GitHub issues and pull requests.",
			};
		}
		const evidence = ctx.sharedBlocklist;
		if (
			!evidence ||
			("accountId" in evidence &&
				evidence.accountId !== ctx.event.actor.externalId)
		) {
			return {
				status: "skipped",
				reason: "Tripwire could not verify this author against Pilot.",
			};
		}
		return {
			status: "evaluated",
			passed: !("accountId" in evidence),
			evidence,
		};
	},
	publicEvidence: () => ({}),
	summarize: (_evidence, passed) =>
		passed ? null : "The author did not pass the Pilot check.",
	remedy: "appeal",
});
