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
		expect(msg.content).toBe("Tripwire blocked acme/web #42.");
		expect(msg.embeds[0]?.url).toBe("https://tripwire.sh/runs/abc");
		expect(msg.embeds[0]?.color).toBe(0xef4444);
		expect(msg.embeds[0]?.description).toContain("your account is 2 days old");
	});
	test("passed: green, no rule blocked it", () => {
		const msg = formatDiscordMessage({
			...PAYLOAD,
			verdict: "pass",
			firedRules: [],
		});
		expect(msg.content).toBe("acme/web #42 passed Tripwire's checks.");
		expect(msg.embeds[0]?.color).toBe(0x22c55e);
		expect(msg.embeds[0]?.description).toBe(
			"No rule blocked this change request.",
		);
	});
	test("blocked with every rule redacted points at the run page", () => {
		const msg = formatDiscordMessage({ ...PAYLOAD, firedRules: [] });
		expect(msg.embeds[0]?.description).toBe(
			"Details are on the Tripwire run page.",
		);
	});
	test("changes needed and closed: red, in their own words", () => {
		const fix = formatDiscordMessage({
			...PAYLOAD,
			verdict: "changes_required",
		});
		expect(fix.content).toBe("Tripwire asked for changes on acme/web #42.");
		expect(fix.embeds[0]?.color).toBe(0xef4444);
		const closed = formatDiscordMessage({
			...PAYLOAD,
			verdict: "close",
			firedRules: [],
		});
		expect(closed.content).toBe("Tripwire closed acme/web #42.");
		expect(closed.embeds[0]?.color).toBe(0xef4444);
		expect(closed.embeds[0]?.description).toBe(
			"Details are on the Tripwire run page.",
		);
	});
	test("the v1 payload carries the new verdicts", () => {
		for (const verdict of ["changes_required", "close"] as const) {
			expect(
				webhookPayloadSchema.safeParse({ ...PAYLOAD, verdict }).success,
			).toBe(true);
		}
	});
	test("human review: amber", () => {
		const msg = formatDiscordMessage({ ...PAYLOAD, verdict: "needs_review" });
		expect(msg.content).toBe("acme/web #42 needs human review.");
		expect(msg.embeds[0]?.color).toBe(0xf59e0b);
	});
});
