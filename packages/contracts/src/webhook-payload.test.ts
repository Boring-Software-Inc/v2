import { describe, expect, test } from "bun:test";
import {
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
