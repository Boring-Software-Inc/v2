import { describe, expect, test } from "bun:test";
import type { RepoScopedEvent } from "@tripwire/contracts";
import { createGenerate } from "./generate.ts";

const NOW = "2026-10-23T10:00:00.000Z";

const EVENT: RepoScopedEvent = {
	id: "evt-1",
	forge: "github",
	deliveryId: "d-1",
	repo: { owner: "acme", name: "widgets", fullName: "acme/widgets" },
	actor: { login: "someone", externalId: "77" },
	occurredAt: NOW,
	receivedAt: NOW,
	kind: "change-request.opened",
	changeRequest: {
		number: 7,
		title: "Add feature",
		headSha: "abc123",
		baseRef: "main",
		headRef: "f",
		draft: false,
		url: "https://github.com/acme/widgets/pull/7",
	},
};

const PROD_402_BODY = {
	error: {
		code: 402,
		message:
			"This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 4500. To increase, visit https://openrouter.ai/settings/credits and upgrade to a paid account",
	},
};

function generateWith(
	status: number,
	body: { error: { code: number; message: string } },
) {
	const fetchImpl = () => Promise.resolve(Response.json(body, { status }));
	return createGenerate({
		apiKey: "test-key",
		defaultModel: "x-ai/grok-4.5",
		reads: null,
		readFile: () => Promise.resolve(null),
		event: EVENT,
		fetch: fetchImpl,
	});
}

const REQUEST = {
	model: undefined,
	maxSteps: 2,
	instructions: "review",
	prompt: "diff",
};

describe("the review agent when the provider is out of credits", () => {
	test("the prod 402 comes back as unavailable, not a throw", async () => {
		const generate = generateWith(402, PROD_402_BODY);
		expect(await generate(REQUEST)).toEqual({ unavailable: "out-of-credits" });
	});

	test("any other provider error still throws", async () => {
		const generate = generateWith(400, {
			error: { code: 400, message: "bad request" },
		});
		await expect(generate(REQUEST)).rejects.toThrow();
	});
});

describe("bounded review generation through the injected transport", () => {
	test("records structured submission, sums step costs and meters bytes without affecting the call", async () => {
		const review = {
			verdict: "pass",
			confidence: 0.9,
			summary: "No issue found.",
			findings: [],
		};
		let requests = 0;
		let bytes = 0;
		const bodies: string[] = [];
		const generate = createGenerate({
			apiKey: "test-key",
			defaultModel: "test-model",
			reads: null,
			event: EVENT,
			readFile: () => Promise.resolve("file contents"),
			countBytesOut: (count) => {
				bytes += count;
				throw new Error("metering offline");
			},
			fetch: async (_input, init) => {
				bodies.push(await new Response(init?.body).text());
				requests++;
				const name = requests === 1 ? "read_file" : "submit_review";
				const args = requests === 1 ? { path: "src/test.ts" } : review;
				return Response.json({
					id: `response-${requests}`,
					model: "test-model",
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: null,
								tool_calls: [
									{
										id: `call-${requests}`,
										type: "function",
										function: { name, arguments: JSON.stringify(args) },
									},
								],
							},
							finish_reason: "tool_calls",
						},
					],
					usage: {
						prompt_tokens: 10,
						completion_tokens: 5,
						total_tokens: 15,
						cost: requests === 1 ? 0.125 : 0.25,
					},
				});
			},
		});
		const result = await generate({ ...REQUEST, prompt: "diff λ" });
		expect(requests).toBe(2);
		expect(bytes).toBe(
			bodies.reduce((total, body) => total + Buffer.byteLength(body), 0),
		);
		expect(bytes).toBeGreaterThan(0);
		expect(result).toMatchObject({
			output: review,
			trace: { costUsd: 0.375, stepsUsed: 2, maxSteps: 2 },
		});
	});

	test("missing provider cost stays null and a missing submission stays null", async () => {
		let requests = 0;
		const generate = createGenerate({
			apiKey: "test-key",
			defaultModel: "test-model",
			reads: null,
			event: EVENT,
			readFile: () => Promise.resolve(null),
			fetch: () => {
				requests++;
				return Promise.resolve(
					Response.json({
						choices: [
							{
								message: {
									role: "assistant",
									content: "not a structured review",
								},
								finish_reason: "stop",
							},
						],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 5,
							total_tokens: 15,
						},
					}),
				);
			},
		});
		expect(await generate(REQUEST)).toMatchObject({
			output: null,
			trace: { costUsd: null, stepsUsed: 1 },
		});
		expect(requests).toBe(1);
	});
});
