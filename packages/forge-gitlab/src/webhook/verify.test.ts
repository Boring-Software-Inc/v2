import { describe, expect, test } from "bun:test";
import { signWebhookBody, verifyWebhookSignature } from "./verify.ts";

/**
 * Verify is security-critical, so it gets a unit test now. This test uses NO
 * captured payload — it signs a body and checks the round trip. Real GitLab
 * webhook fixtures must arrive through `/capture-fixture` (see testing.md); do
 * not hand-write them here.
 */
describe("verifyWebhookSignature (gitlab)", () => {
	const secret = "s3cr3t-token";
	const body = '{"object_kind":"merge_request"}';

	test("accepts a valid signing token", () => {
		const signature = signWebhookBody(body, secret);
		expect(verifyWebhookSignature({ body, signature }, secret)).toBe(true);
	});

	test("rejects a signing token from the wrong secret", () => {
		const signature = signWebhookBody(body, "wrong-secret");
		expect(verifyWebhookSignature({ body, signature }, secret)).toBe(false);
	});

	test("rejects a tampered body", () => {
		const signature = signWebhookBody(body, secret);
		const tampered = '{"object_kind":"push"}';
		expect(verifyWebhookSignature({ body: tampered, signature }, secret)).toBe(
			false,
		);
	});

	test("accepts the legacy plain-text secret token", () => {
		expect(verifyWebhookSignature({ body, signature: secret }, secret)).toBe(
			true,
		);
	});

	test("rejects a wrong plain-text token", () => {
		expect(verifyWebhookSignature({ body, signature: "nope" }, secret)).toBe(
			false,
		);
	});

	test("rejects a missing signature", () => {
		expect(verifyWebhookSignature({ body, signature: null }, secret)).toBe(
			false,
		);
	});
});
