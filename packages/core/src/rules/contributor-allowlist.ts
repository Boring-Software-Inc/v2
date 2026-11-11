import {
	CONTRIBUTOR_ALLOWLIST_RULE_ID,
	contributorAllowlistConfigSchema,
	contributorAllowlistEvidenceSchema,
} from "@tripwire/contracts";
import { defineRule } from "./define.ts";

export const contributorAllowlist = defineRule({
	id: CONTRIBUTOR_ALLOWLIST_RULE_ID,
	version: 1,
	configSchema: contributorAllowlistConfigSchema,
	resultSchema: contributorAllowlistEvidenceSchema,
	evaluate({ event, authorAllowlisted }) {
		if (event.forge !== "github" || authorAllowlisted == null) {
			return {
				status: "skipped",
				reason: "Tripwire could not verify the author's allowlist status.",
			};
		}
		return {
			status: "evaluated",
			passed: authorAllowlisted,
			evidence: { allowlisted: authorAllowlisted },
		};
	},
	publicEvidence: () => ({}),
	summarize: (_evidence, passed) =>
		passed
			? null
			: "This repository limits contributions to approved accounts.",
	remedy: "appeal",
});
