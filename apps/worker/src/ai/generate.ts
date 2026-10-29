import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { RepoScopedEvent } from "@tripwire/contracts";
import {
	aiReviewOutputSchema,
	boundAiReviewTrace,
	forgeFileReadResultSchema,
	isAiOutOfCreditsError,
	providerErrorSchema,
} from "@tripwire/contracts";
import type { AiReviewGenerate } from "@tripwire/core";
import type { ForgeReadResult } from "@tripwire/forge";
import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { z } from "zod";
import { changeRequestHead, type WorkerReads } from "../context.ts";

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
	readFile: (
		repo: string,
		path: string,
		ref: string,
	) => Promise<string | null | ForgeReadResult<string>>;
	event: RepoScopedEvent;
	/** Best-effort metering of request bytes sent to OpenRouter. Optional. */
	countBytesOut?: (bytes: number) => void;
	fetch?: (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => Promise<Response>;
}): AiReviewGenerate {
	const countBytesOut = options.countBytesOut;
	const baseFetch = options.fetch ?? fetch;
	// Wrap fetch only to size the request body; the response is untouched.
	const meteredFetch = countBytesOut
		? (
				input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				if (typeof init?.body === "string") {
					try {
						countBytesOut(Buffer.byteLength(init.body));
					} catch {
						// metering must never break the model call
					}
				}
				return baseFetch(input, init);
			}
		: options.fetch;
	const openrouter = createOpenRouter({
		apiKey: options.apiKey,
		...(meteredFetch ? { fetch: meteredFetch as typeof fetch } : {}),
	});
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

		const runReview = () =>
			generateText({
				// usage.include turns on OpenRouter usage accounting, so each step's
				// providerMetadata carries token counts AND cost (§8 metering).
				model: openrouter(resolvedModel, { usage: { include: true } }),
				system: instructions,
				prompt,
				stopWhen: [stepCountIs(maxSteps), hasToolCall("submit_review")],
				tools: {
					read_file: tool({
						description:
							"read a file from the change request's head for context",
						inputSchema: z.object({ path: z.string() }),
						execute: async ({ path }) => {
							const read = await options.readFile(repo, path, headRef);
							if (read === null) return "(file not found)";
							const parsed = forgeFileReadResultSchema.safeParse(read);
							if (!parsed.success)
								return "(file unavailable: invalid-response)";
							return parsed.data.ok
								? parsed.data.value
								: `(file unavailable: ${parsed.data.reason})`;
						},
					}),
					get_commits: tool({
						description: "list the change request's commits",
						inputSchema: z.object({}),
						execute: async () =>
							options.reads && number !== null
								? await options.reads.getCommits(
										repo,
										number,
										changeRequestHead(options.event),
									)
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
										options.event.actor.externalId,
									)
								: "(unavailable)",
					}),
					submit_review: tool({
						description:
							"submit the final structured review. call exactly once.",
						inputSchema: aiReviewOutputSchema,
						execute: (output) => {
							review = output;
							return "review recorded";
						},
					}),
				},
			});
		let result: Awaited<ReturnType<typeof runReview>>;
		try {
			result = await runReview();
		} catch (error) {
			const parsed = providerErrorSchema.safeParse(error);
			if (parsed.success && isAiOutOfCreditsError(parsed.data)) {
				return { unavailable: "out-of-credits" };
			}
			throw error;
		}

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
