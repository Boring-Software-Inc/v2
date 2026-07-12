import { profileReadmeConfigSchema } from "@tripwire/contracts";
import { z } from "zod";
import { defineRule } from "./define.ts";

/**
 * profile-readme@1 — the contributor's profile must carry at least
 * `minLength` characters of README/bio text. Identity investment is cheap to
 * fake once but expensive at bot-farm scale.
 */
export const profileReadme = defineRule({
	id: "profile-readme",
	version: 1,
	configSchema: profileReadmeConfigSchema,
	resultSchema: z.object({
		hasProfileText: z.boolean(),
		length: z.number(),
		minLength: z.number(),
	}),
	evaluate(ctx, config) {
		if (ctx.contributor === null) {
			return { status: "skipped", reason: "contributor profile unavailable" };
		}
		const text = ctx.contributor.profileText?.trim() ?? "";
		return {
			status: "evaluated",
			passed: text.length >= config.minLength,
			evidence: {
				hasProfileText: text.length > 0,
				length: text.length,
				minLength: config.minLength,
			},
		};
	},
	publicEvidence: (e) => ({
		hasProfileText: e.hasProfileText,
		length: e.length,
	}),
	summarize: (e) =>
		`this profile has ${e.length} ${e.length === 1 ? "character" : "characters"} of text`,
	// Fixable off-change — add a profile readme/bio (not this PR, but the person's).
	remedy: "revise",
});
