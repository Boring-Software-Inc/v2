import { honeypotConfigSchema } from "@tripwire/contracts";
import { evaluateSignalRule, globMatch, noneMatch } from "@tripwire/sdk";
import { z } from "zod";
import { readContextSignal, rule, signals } from "./context-forge.ts";
import { defineRule } from "./define.ts";

/**
 * honeypot@1 — no legitimate change request touches these paths (CI
 * workflows, release scripts, planted bait files). Touching one is a
 * high-signal red flag. Evidence: exactly which paths were touched.
 * Authored as an SDK signal rule: pr.changedPaths noneMatch(the watched
 * globs). The glob matcher moved verbatim into the SDK; the verdict and the
 * evidence both come from that one function.
 */
export const honeypot = defineRule({
	id: "honeypot",
	version: 1,
	configSchema: honeypotConfigSchema,
	resultSchema: z.object({
		touched: z.array(z.string()),
	}),
	async evaluate(ctx, config) {
		const read = await readContextSignal("pr.changedPaths", ctx);
		if (!read.ok) {
			return { status: "skipped", reason: read.reason };
		}
		const requirement = rule("honeypot", {
			when: signals.pr.changedPaths,
			comparison: noneMatch(config.paths),
			severity: "high",
		});
		const { passed } = evaluateSignalRule(requirement, {
			value: read.value,
			now: ctx.now,
		});
		const touched = read.value.filter((path) =>
			config.paths.some((pattern) => globMatch(pattern, path)),
		);
		return { status: "evaluated", passed, evidence: { touched } };
	},
	// The touched paths are from the contributor's own diff — public. The
	// watched globs live in config and never reach evidence, so they stay gated.
	publicEvidence: (e) => ({ touched: e.touched }),
	summarize: (e) =>
		e.touched.length === 0
			? null
			: e.touched.length === 1
				? "It changes a protected file."
				: `It changes ${e.touched.length} protected files.`,
	// Fixable in the change itself — don't touch the protected paths.
	remedy: "revise",
});
