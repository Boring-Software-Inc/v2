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

function generateWith(status: number, body: unknown) {
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
