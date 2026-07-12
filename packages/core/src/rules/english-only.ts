import { englishOnlyConfigSchema } from "@tripwire/contracts";
import { truncate } from "@tripwire/utils";
import { z } from "zod";
import { defineRule } from "./define.ts";

/**
 * Ratio of non-Latin letters among all letters. Deterministic and dumb on
 * purpose — a heuristic gate, not a language model.
 */
function nonLatinRatio(text: string): { ratio: number; letters: number } {
	let letters = 0;
	let nonLatin = 0;
	for (const ch of text) {
		if (!/\p{L}/u.test(ch)) {
			continue;
		}
		letters++;
		if (!/[\p{Script=Latin}]/u.test(ch)) {
			nonLatin++;
		}
	}
	return { ratio: letters === 0 ? 0 : nonLatin / letters, letters };
}

/**
 * english-only@1 — the change request title / comment body must be
 * predominantly Latin-script. Evidence: the measured ratio and a sample.
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
	evaluate(ctx, config) {
		const text =
			ctx.event.kind === "comment.created"
				? ctx.event.comment.body
				: "changeRequest" in ctx.event
					? ctx.event.changeRequest.title
					: null;
		if (text === null || text.trim() === "") {
			return { status: "skipped", reason: "no text to examine" };
		}
		const { ratio, letters } = nonLatinRatio(text);
		if (letters < 4) {
			return { status: "skipped", reason: "not enough letters to judge" };
		}
		return {
			status: "evaluated",
			passed: ratio <= config.maxNonLatinRatio,
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
	summarize: () => "the title isn't in latin script",
	// Fixable in the change itself — rewrite the title/body in latin script.
	remedy: "revise",
});
