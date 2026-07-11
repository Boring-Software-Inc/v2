import { createAnthropic } from "@ai-sdk/anthropic";
import type { NormalizedEvent } from "@tripwire/contracts";
import { aiReviewOutputSchema } from "@tripwire/contracts";
import type { AiReviewGenerate } from "@tripwire/core";
import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { WorkerReads } from "../context.ts";

/**
 * §8 — the bounded tool loop, NOT an open agent. Tools are thin wrappers over
 * the ForgeAdapter read surface (never a GitHub SDK); the loop stops on
 * `submit_review` or the hard step cap. The diff was provided up front, so
 * trivial change requests resolve in one step with zero tool calls. The full
 * trace (steps, tool calls, usage) is returned for evidence persistence.
 */
export function createGenerate(options: {
	apiKey: string;
	reads: WorkerReads | null;
	readFile: (repo: string, path: string, ref: string) => Promise<string | null>;
	event: NormalizedEvent;
}): AiReviewGenerate {
	const anthropic = createAnthropic({ apiKey: options.apiKey });
	const repo = options.event.repo.fullName;
	const number =
		"changeRequest" in options.event
			? options.event.changeRequest.number
			: null;
	const headRef =
		"changeRequest" in options.event
			? options.event.changeRequest.headSha
			: "HEAD";

	return async ({ model, maxSteps, instructions, prompt }) => {
		let review: unknown = null;

		const result = await generateText({
			model: anthropic(model),
			system: instructions,
			prompt,
			stopWhen: [stepCountIs(maxSteps), hasToolCall("submit_review")],
			tools: {
				read_file: tool({
					description: "read a file from the change request's head for context",
					inputSchema: z.object({ path: z.string() }),
					execute: async ({ path }) =>
						(await options.readFile(repo, path, headRef)) ?? "(file not found)",
				}),
				get_commits: tool({
					description: "list the change request's commits",
					inputSchema: z.object({}),
					execute: async () =>
						options.reads && number !== null
							? await options.reads.getCommits(repo, number)
							: "(unavailable)",
				}),
				get_contributor_context: tool({
					description: "fetch the contributor's forge profile and history",
					inputSchema: z.object({}),
					execute: async () =>
						options.reads
							? await options.reads.getContributorProfile(
									repo,
									options.event.actor.login,
								)
							: "(unavailable)",
				}),
				submit_review: tool({
					description: "submit the final structured review. call exactly once.",
					inputSchema: aiReviewOutputSchema,
					execute: (output) => {
						review = output;
						return "review recorded";
					},
				}),
			},
		});

		return {
			output: review,
			trace: {
				model,
				steps: result.steps.map((step) => ({
					text: step.text,
					toolCalls: step.toolCalls.map((call) => ({
						toolName: call.toolName,
						input: call.input,
					})),
				})),
				usage: result.usage,
				finishReason: result.finishReason,
			},
		};
	};
}
