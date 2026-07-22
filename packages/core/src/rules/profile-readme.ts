import { profileReadmeConfigSchema } from "@tripwire/contracts";
import { atLeast, evaluateSignalRule } from "@tripwire/sdk";
import { z } from "zod";
import { readContextSignal, rule, signals } from "./context-forge.ts";
import { defineRule } from "./define.ts";

/**
 * profile-readme@1 — the contributor's profile must carry at least
 * `minLength` characters of README/bio text. Identity investment is cheap to
 * fake once but expensive at bot-farm scale. Authored as an SDK signal rule
 * over contributor.profileText's trimmedLength; the verdict is unchanged and
 * the evidence length is the exact value the verdict compared.
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
	async evaluate(ctx, config) {
		const read = await readContextSignal("contributor.profileText", ctx);
		if (!read.ok) {
			return { status: "skipped", reason: read.reason };
		}
		const requirement = rule("profile readme", {
			when: signals.contributor.profileText.trimmedLength,
			comparison: atLeast(config.minLength),
			severity: "low",
		});
		const { passed, resolvedValue } = evaluateSignalRule(requirement, {
			value: read.value,
			now: ctx.now,
		});
		// The trimmedLength transform yields a number by construction.
		const length = resolvedValue as number;
		return {
			status: "evaluated",
			passed,
			evidence: {
				hasProfileText: length > 0,
				length,
				minLength: config.minLength,
			},
		};
	},
	publicEvidence: (e) => ({
		hasProfileText: e.hasProfileText,
		length: e.length,
	}),
	summarize: (e) =>
		e.hasProfileText
			? "your github profile readme is too short"
			: "your github profile has no readme",
	// Fixable off-change — add a profile readme/bio (not this PR, but the person's).
	remedy: "revise",
});
