import {
	type AiReviewOutput,
	aiReviewConfigSchema,
	aiReviewOutputSchema,
} from "@tripwire/contracts";
import { truncate } from "@tripwire/utils";
import { z } from "zod";
import type { RuleContext } from "../../context.ts";
import { defineRule } from "../define.ts";
import instructions from "./instructions.md" with { type: "text" };
import template from "./template.md" with { type: "text" };

/**
 * ai-review@1 (§8) — bounded tool loop, structured output, injected effect.
 * `instructions.md` + `template.md` are versioned WITH this rule: a material
 * prompt change is `ai-review@2`. The full trace persists in evidence.
 */

const DIFF_CHAR_BUDGET = 60_000;

function renderPrompt(ctx: RuleContext): string | null {
	if (!("changeRequest" in ctx.event)) {
		return null;
	}
	const cr = ctx.event.changeRequest;
	const diff =
		ctx.diff
			?.map((file) => {
				const header = `--- ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`;
				return file.patch ? `${header}\n${file.patch}` : header;
			})
			.join("\n\n") ?? "(diff unavailable)";
	return template
		.replace("{{repoFullName}}", ctx.event.repo.fullName)
		.replace("{{number}}", String(cr.number))
		.replace("{{title}}", cr.title)
		.replace("{{authorLogin}}", ctx.event.actor.login)
		.replace("{{authorCreatedAt}}", ctx.contributor?.createdAt ?? "unknown")
		.replace(
			"{{mergedInRepo}}",
			String(ctx.contributor?.mergedInRepo ?? "unknown"),
		)
		.replace("{{draft}}", String(cr.draft))
		.replace("{{filesChanged}}", String(ctx.diff?.length ?? "unknown"))
		.replace("{{diff}}", truncate(diff, DIFF_CHAR_BUDGET));
}

export const aiReview = defineRule({
	id: "ai-review",
	version: 1,
	configSchema: aiReviewConfigSchema,
	resultSchema: z.object({
		output: aiReviewOutputSchema,
		/** Full invocation trace — messages, tool calls, tokens, cost. */
		trace: z.unknown(),
	}),
	async evaluate(ctx, config) {
		if (!ctx.generate) {
			return {
				status: "skipped",
				reason: "generate unavailable (no AI credentials)",
			};
		}
		const prompt = renderPrompt(ctx);
		if (prompt === null) {
			return { status: "skipped", reason: "not a change-request event" };
		}
		const response = await ctx.generate({
			model: config.model,
			maxSteps: config.maxSteps,
			instructions,
			prompt,
		});
		const parsed = aiReviewOutputSchema.safeParse(response.output);
		if (!parsed.success) {
			return {
				status: "skipped",
				reason: `review output failed the muzzle schema: ${parsed.error.issues[0]?.message}`,
			};
		}
		const output: AiReviewOutput = parsed.data;
		return {
			status: "evaluated",
			passed: output.verdict === "pass",
			evidence: { output, trace: response.trace },
		};
	},
});
