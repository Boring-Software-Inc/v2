import { maxFilesChangedConfigSchema } from "@tripwire/contracts";
import { atMost, evaluateSignalRule } from "@tripwire/sdk";
import { z } from "zod";
import { readContextSignal, rule, signals } from "./context-forge.ts";
import { defineRule } from "./define.ts";

/**
 * max-files-changed@1 — the change request may touch at most `max` files.
 * The 4000-lines-of-vendored-code PR dies here. Authored as an SDK signal
 * rule over pr.filesChanged; the verdict is unchanged.
 */
export const maxFilesChanged = defineRule({
	id: "max-files-changed",
	version: 1,
	configSchema: maxFilesChangedConfigSchema,
	resultSchema: z.object({
		filesChanged: z.number(),
		max: z.number(),
	}),
	async evaluate(ctx, config) {
		const read = await readContextSignal("pr.filesChanged", ctx);
		if (!read.ok) {
			return { status: "skipped", reason: read.reason };
		}
		const requirement = rule("max files changed", {
			when: signals.pr.filesChanged,
			comparison: atMost(config.max),
			severity: "low",
		});
		const { passed } = evaluateSignalRule(requirement, {
			value: read.value,
			now: ctx.now,
		});
		return {
			status: "evaluated",
			passed,
			evidence: { filesChanged: read.value, max: config.max },
		};
	},
	publicEvidence: (e) => ({ filesChanged: e.filesChanged }),
	summarize: (e) =>
		`this change touches ${e.filesChanged} ${e.filesChanged === 1 ? "file" : "files"}`,
	// Fixable in the change itself — split it or drop files.
	remedy: "revise",
});
