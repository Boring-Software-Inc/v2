import { describe, expect, test } from "bun:test";
import {
	formatDiscordMessage,
	type WebhookPayload,
	webhookPayloadSchema,
} from "./webhook-payload.ts";

const PAYLOAD: WebhookPayload = {
	version: 1,
	verdict: "block",
	org: "acme",
	repo: "acme/web",
	changeRequest: { number: 42, title: "add crypto donate", author: "drive-by" },
	firedRules: [
		{ ruleId: "account-age", summary: "your account is 2 days old" },
		{ ruleId: "crypto-address", summary: "it adds a crypto address" },
	],
	runUrl: "https://tripwire.sh/runs/abc",
	timestamp: "2026-07-21T00:00:00.000Z",
};

describe("webhookPayloadSchema — the public v1 contract", () => {
	test("accepts a well-formed payload", () => {
		expect(webhookPayloadSchema.parse(PAYLOAD)).toEqual(PAYLOAD);
	});
	test("pins version to 1", () => {
		expect(
			webhookPayloadSchema.safeParse({ ...PAYLOAD, version: 2 }).success,
		).toBe(false);
	});
	test("carries no url secret in the body shape", () => {
		expect(Object.keys(PAYLOAD)).not.toContain("url");
	});
});

describe("formatDiscordMessage — own formatter, verdict-colored", () => {
	test("blocked: content + embed with reasons and run link", () => {
		const msg = formatDiscordMessage(PAYLOAD);
		expect(msg.content).toBe("acme/web #42 blocked.");
		expect(msg.embeds[0]?.url).toBe("https://tripwire.sh/runs/abc");
		expect(msg.embeds[0]?.color).toBe(0xef4444);
		expect(msg.embeds[0]?.description).toContain("your account is 2 days old");
	});
	test("passed: green, nothing tripped", () => {
		const msg = formatDiscordMessage({
			...PAYLOAD,
			verdict: "pass",
			firedRules: [],
		});
		expect(msg.content).toBe("acme/web #42 passed.");
		expect(msg.embeds[0]?.color).toBe(0x22c55e);
		expect(msg.embeds[0]?.description).toBe("nothing tripped.");
	});
	test("sent to review: amber", () => {
		const msg = formatDiscordMessage({ ...PAYLOAD, verdict: "needs_review" });
		expect(msg.content).toContain("sent to review");
		expect(msg.embeds[0]?.color).toBe(0xf59e0b);
	});
});
