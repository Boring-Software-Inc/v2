import { describe, expect, test } from "bun:test";
import { normalizeWebhook } from "./normalize.ts";
import { signWebhookBody, verifyWebhookSignature } from "./verify.ts";

/**
 * Payload shapes taken from open-git's SENDER, not its docs:
 * `apps/web/lib/pull-requests/create-pull-request.ts` calls
 * `emitPullRequestWebhooks` with no author field, which is the whole reason
 * pull_request events cannot be normalized.
 */
const raw = (eventName: string, body: unknown) => ({
	deliveryId: "d-1",
	eventName,
	body: JSON.stringify(body),
	signature: null,
});

const REPO = { id: "repo-uuid", name: "api", owner: "acme" };
const PR = { id: "pr-uuid", number: 12, title: "Fix timeout", head_sha: "abc" };

describe("open-git webhook verification", () => {
	test("accepts a correct signature and rejects a wrong secret", () => {
		const body = JSON.stringify({ hello: "world" });
		const signature = signWebhookBody(body, "s3cret");
		expect(verifyWebhookSignature({ body, signature }, "s3cret")).toBe(true);
		expect(verifyWebhookSignature({ body, signature }, "wrong")).toBe(false);
	});

	test("rejects a missing or unprefixed signature", () => {
		const body = "{}";
		expect(verifyWebhookSignature({ body, signature: null }, "s")).toBe(false);
		expect(verifyWebhookSignature({ body, signature: "deadbeef" }, "s")).toBe(
			false,
		);
	});
});

describe("open-git normalization", () => {
	test("a comment normalizes with its real author", () => {
		const event = normalizeWebhook(
			raw("pull_request.comment", {
				installation_id: "inst-1",
				repository: REPO,
				pull_request: PR,
				comment: { id: "c-1", author: "madison", body: "Can you add a test?" },
			}),
			"2026-08-16T00:00:00.000Z",
		);
		// Narrow before reading `repo`: NormalizedEvent is a union and the
		// installation variants carry repositories, not a single repo.
		if (event?.kind !== "comment.created") {
			throw new Error(`expected comment.created, got ${event?.kind}`);
		}
		expect(event.forge).toBe("opengit");
		expect(event.actor.login).toBe("madison");
		expect(event.repo.fullName).toBe("acme/api");
		expect(event.comment.subjectNumber).toBe(12);
		expect(event.comment.byTripwire).toBe(false);
	});

	/**
	 * THE ACTOR GAP. These must return null, never a placeholder author — a
	 * fabricated contributor would poison scoring, moderation and the audit
	 * trail with a user who never existed.
	 */
	test.each([
		"opened",
		"synchronize",
		"closed",
	])("pull_request.%s is not ingested — the payload carries no author", (action) => {
		const event = normalizeWebhook(
			raw(`pull_request.${action}`, {
				installation_id: "inst-1",
				repository: REPO,
				pull_request: PR,
			}),
			"2026-08-16T00:00:00.000Z",
		);
		expect(event).toBeNull();
	});

	test("a comment with a null author is not ingested", () => {
		// open-git sends null for a system note — nothing to evaluate.
		const event = normalizeWebhook(
			raw("pull_request.comment", {
				repository: REPO,
				pull_request: PR,
				comment: { id: "c-2", author: null, body: "merged" },
			}),
			"2026-08-16T00:00:00.000Z",
		);
		expect(event).toBeNull();
	});

	test("installation events are not ingested here", () => {
		expect(
			normalizeWebhook(
				raw("installation.created", {
					installation_id: "i-1",
					repositories: ["r1"],
				}),
				"2026-08-16T00:00:00.000Z",
			),
		).toBeNull();
	});

	test("a malformed comment payload throws so the worker quarantines it", () => {
		expect(() =>
			normalizeWebhook(
				raw("pull_request.comment", { repository: REPO }),
				"2026-08-16T00:00:00.000Z",
			),
		).toThrow();
	});
});
