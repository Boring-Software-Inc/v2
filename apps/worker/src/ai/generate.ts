import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { RepoScopedEvent } from "@tripwire/contracts";
import { aiReviewOutputSchema, boundAiReviewTrace } from "@tripwire/contracts";
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
/**
 * Sum per-step OpenRouter cost from provider metadata. Each generateText step is
 * one HTTP request; usage accounting (usage.include) puts cost on each step's
 * providerMetadata.openrouter.usage.cost. Returns null when no step reported a
 * cost, so metering never invents a number.
 */
function sumStepCost(
	steps: readonly { providerMetadata?: Record<string, unknown> }[],
): number | null {
	let total = 0;
	let seen = false;
	for (const step of steps) {
		const openrouter = step.providerMetadata?.openrouter as
			| { usage?: { cost?: unknown } }
			| undefined;
		const cost = openrouter?.usage?.cost;
		if (typeof cost === "number" && Number.isFinite(cost)) {
			total += cost;
			seen = true;
		}
	}
	return seen ? total : null;
}

export function createGenerate(options: {
	apiKey: string;
	/** AI_REVIEW_MODEL env — explicit rule config wins over this. */
	defaultModel: string;
	reads: WorkerReads | null;
	readFile: (repo: string, path: string, ref: string) => Promise<string | null>;
	event: RepoScopedEvent;
}): AiReviewGenerate {
	const openrouter = createOpenRouter({ apiKey: options.apiKey });
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
		const resolvedModel = model ?? options.defaultModel;

		const result = await generateText({
			// usage.include turns on OpenRouter usage accounting, so each step's
			// providerMetadata carries token counts AND cost (§8 metering).
			model: openrouter(resolvedModel, { usage: { include: true } }),
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

		// Per-run cost is the sum of per-step OpenRouter cost (one HTTP request per
		// step). Null when no step reported a cost, so metering degrades to tokens.
		const costUsd = sumStepCost(result.steps);

		// Bounded at the source (§8): the trace persists as gated evidence, so its
		// size can't be dictated by attacker-influenced model output. Was unbounded.
		return {
			output: review,
			trace: boundAiReviewTrace({
				model: resolvedModel,
				maxSteps,
				rawSteps: result.steps.map((step) => ({
					text: step.text,
					toolCalls: step.toolCalls.map((call) => ({
						toolName: call.toolName,
						input: call.input,
					})),
				})),
				usage: result.usage,
				costUsd,
			}),
		};
	};
}
