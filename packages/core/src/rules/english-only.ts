import { englishOnlyConfigSchema } from "@tripwire/contracts";
import { atMost, evaluateSignalRule, resolveSignalValue } from "@tripwire/sdk";
import { truncate } from "@tripwire/utils";
import { z } from "zod";
import { readContextSignal, rule, signals } from "./context-forge.ts";
import { defineRule } from "./define.ts";

/**
 * english-only@1 — the change request title / comment body must be
 * predominantly Latin-script. Evidence: the measured ratio and a sample.
 * Authored as an SDK signal rule over the text signal's nonLatinRatio
 * transform; the letters guard reads the letterCount transform through the
 * evaluator's own resolution. One scan implementation, two projections; the
 * verdict is unchanged.
 */
export const englishOnly = defineRule({
	id: "english-only",
	version: 1,
	configSchema: englishOnlyConfigSchema,
	resultSchema: z.object({
		ratio: z.number(),
		lettersExamined: z.number(),
		sample: z.string(),
	}),
	async evaluate(ctx, config) {
		const source =
			ctx.event.kind === "comment.created"
				? ("comment.body" as const)
				: "changeRequest" in ctx.event
					? ("pr.title" as const)
					: null;
		if (source === null) {
			return { status: "skipped", reason: "no text to examine" };
		}
		const read = await readContextSignal(source, ctx);
		if (!read.ok) {
			return { status: "skipped", reason: read.reason };
		}
		const text = read.value;
		if (text.trim() === "") {
			return { status: "skipped", reason: "no text to examine" };
		}
		const when =
			source === "comment.body" ? signals.comment.body : signals.pr.title;
		// The evaluator's own metric resolution, not a copy of the scan.
		const letters = resolveSignalValue(when.letterCount.ref, {
			value: text,
			now: ctx.now,
		}).value as number;
		if (letters < 4) {
			return { status: "skipped", reason: "not enough letters to judge" };
		}
		const requirement = rule("english only", {
			when: when.nonLatinRatio,
			comparison: atMost(config.maxNonLatinRatio),
			severity: "low",
		});
		const { passed, resolvedValue } = evaluateSignalRule(requirement, {
			value: text,
			now: ctx.now,
		});
		// The nonLatinRatio transform yields a number by construction. The
		// verdict compares the raw ratio; the evidence rounds for display.
		const ratio = resolvedValue as number;
		return {
			status: "evaluated",
			passed,
			evidence: {
				ratio: Number(ratio.toFixed(4)),
				lettersExamined: letters,
				sample: truncate(text, 120),
			},
		};
	},
	// No threshold in the evidence — ratio/sample are observed facts.
	publicEvidence: (e) => ({
		ratio: e.ratio,
		lettersExamined: e.lettersExamined,
		sample: e.sample,
	}),
	summarize: () => "Most of the title is not written in the Latin alphabet.",
	// Fixable in the change itself — rewrite the title/body in latin script.
	remedy: "revise",
});
