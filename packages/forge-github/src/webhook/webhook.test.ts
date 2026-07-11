import { describe, expect, test } from "bun:test";
import { normalizedEventSchema } from "@tripwire/contracts";
import { normalizeWebhook } from "./normalize.ts";
import { signWebhookBody, verifyWebhookSignature } from "./verify.ts";

const NOW = "2026-07-11T00:00:00.000Z";

async function fixture(name: string): Promise<string> {
	const path = new URL(`../../fixtures/${name}.json`, import.meta.url).pathname;
	return await Bun.file(path).text();
}

describe("verifyWebhookSignature", () => {
	const secret = "test-secret";
	const body = '{"hello":"world"}';

	test("accepts a correctly signed body", () => {
		const signature = signWebhookBody(body, secret);
		expect(verifyWebhookSignature({ body, signature }, secret)).toBe(true);
	});

	test("rejects a tampered body, wrong secret, and missing header", () => {
		const signature = signWebhookBody(body, secret);
		expect(
			verifyWebhookSignature({ body: `${body} `, signature }, secret),
		).toBe(false);
		expect(verifyWebhookSignature({ body, signature }, "other")).toBe(false);
		expect(verifyWebhookSignature({ body, signature: null }, secret)).toBe(
			false,
		);
		expect(
			verifyWebhookSignature({ body, signature: "sha256=short" }, secret),
		).toBe(false);
	});
});

describe("normalizeWebhook — fixture corpus (contract layer §11)", () => {
	test("pull_request.opened → change-request.opened", async () => {
		const body = await fixture("pull_request.opened");
		const event = normalizeWebhook(
			{ deliveryId: "d-1", eventName: "pull_request", body, signature: null },
			NOW,
		);
		expect(event).not.toBeNull();
		expect(event?.kind).toBe("change-request.opened");
		if (event?.kind !== "change-request.opened") {
			throw new Error("unreachable");
		}
		expect(event.changeRequest.number).toBeGreaterThan(0);
		expect(event.changeRequest.headSha).toMatch(/^[0-9a-f]{40}$/);
		expect(normalizedEventSchema.parse(event)).toBeTruthy();
	});

	test("pull_request.synchronize → change-request.updated", async () => {
		const body = await fixture("pull_request.synchronize");
		const event = normalizeWebhook(
			{ deliveryId: "d-2", eventName: "pull_request", body, signature: null },
			NOW,
		);
		expect(event?.kind).toBe("change-request.updated");
		expect(normalizedEventSchema.parse(event)).toBeTruthy();
	});

	test("pull_request.closed → change-request.closed", async () => {
		const body = await fixture("pull_request.closed");
		const event = normalizeWebhook(
			{ deliveryId: "d-3", eventName: "pull_request", body, signature: null },
			NOW,
		);
		expect(event?.kind).toBe("change-request.closed");
		expect(normalizedEventSchema.parse(event)).toBeTruthy();
	});

	test("issue_comment.created → comment.created", async () => {
		const body = await fixture("issue_comment.created");
		const event = normalizeWebhook(
			{ deliveryId: "d-4", eventName: "issue_comment", body, signature: null },
			NOW,
		);
		expect(event?.kind).toBe("comment.created");
		if (event?.kind !== "comment.created") {
			throw new Error("unreachable");
		}
		expect(event.comment.subjectNumber).toBeGreaterThan(0);
		expect(normalizedEventSchema.parse(event)).toBeTruthy();
	});

	test("push → push", async () => {
		const body = await fixture("push");
		const event = normalizeWebhook(
			{ deliveryId: "d-5", eventName: "push", body, signature: null },
			NOW,
		);
		expect(event?.kind).toBe("push");
		expect(normalizedEventSchema.parse(event)).toBeTruthy();
	});

	test("non-ingested kinds return null; malformed ingested payloads throw", async () => {
		const ping = await fixture("ping");
		expect(
			normalizeWebhook(
				{ deliveryId: "d-6", eventName: "ping", body: ping, signature: null },
				NOW,
			),
		).toBeNull();
		expect(() =>
			normalizeWebhook(
				{
					deliveryId: "d-7",
					eventName: "pull_request",
					body: '{"action":"opened"}',
					signature: null,
				},
				NOW,
			),
		).toThrow();
	});
});

describe("normalizeWebhook — installation sync (self-captured fixture)", () => {
	test("installation created (OUR App's live delivery) → installation.created", async () => {
		const body = await fixture("installation.created");
		const event = normalizeWebhook(
			{ deliveryId: "d-i1", eventName: "installation", body, signature: null },
			NOW,
		);
		expect(event?.kind).toBe("installation.created");
		if (!event || !("installation" in event)) {
			throw new Error("wrong kind");
		}
		expect(event.installation.externalId).toBe("145946161");
		expect(event.installation.account).toBe("Boring-Software-Inc");
		expect(event.repositories).toEqual([
			{
				externalId: "1297742259",
				owner: "Boring-Software-Inc",
				name: "scratch",
				fullName: "Boring-Software-Inc/scratch",
				private: false,
			},
		]);
		expect(normalizedEventSchema.parse(event)).toBeTruthy();
	});

	test("installation deleted → installation.deleted", async () => {
		const body = await fixture("installation.deleted");
		const event = normalizeWebhook(
			{ deliveryId: "d-i2", eventName: "installation", body, signature: null },
			NOW,
		);
		expect(event?.kind).toBe("installation.deleted");
	});

	test("installation_repositories added/removed map to their kinds", async () => {
		for (const [name, kind] of [
			["installation_repositories.added", "installation-repositories.added"],
			[
				"installation_repositories.removed",
				"installation-repositories.removed",
			],
		] as const) {
			const body = await fixture(name);
			const event = normalizeWebhook(
				{
					deliveryId: `d-${name}`,
					eventName: "installation_repositories",
					body,
					signature: null,
				},
				NOW,
			);
			expect(event?.kind).toBe(kind);
			if (!event || !("installation" in event)) {
				throw new Error("wrong kind");
			}
			expect(event.repositories.length).toBeGreaterThan(0);
		}
	});
});
