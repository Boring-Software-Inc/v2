import { describe, expect, test } from "bun:test";
import type { EventKind } from "@tripwire/contracts";
import { normalizeWebhook } from "./normalize.ts";
import { signWebhookBody, verifyWebhookSignature } from "./verify.ts";

/**
 * Payload shapes taken from open-git's SENDER and its webhook docs
 * (`docs/integrations/webhooks.md`), which now put `author` and `body` on every
 * pull-request event and add `pull_request.edited` for a title/description
 * change. `author` is what makes these events ingestable at all — tripwire
 * evaluates a contributor, and before it there was nobody to name.
 */
const raw = (eventName: string, body: unknown) => ({
	deliveryId: "d-1",
	eventName,
	body: JSON.stringify(body),
	signature: null,
});

const REPO = { id: "repo-uuid", name: "api", owner: "acme" };
/** No author — an imported or system-authored change request. */
const PR = { id: "pr-uuid", number: 12, title: "Fix timeout", head_sha: "abc" };
const AUTHORED_PR = {
	...PR,
	author: "madison",
	body: "The worker hangs after 30s.",
};

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

/** Annotated so `kind` stays an EventKind rather than widening to string. */
const PR_KINDS: readonly (readonly [string, EventKind])[] = [
	["opened", "change-request.opened"],
	["edited", "change-request.updated"],
	["synchronize", "change-request.updated"],
	["closed", "change-request.closed"],
];

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

	test.each(PR_KINDS)("pull_request.%s normalizes to %s", (action, kind) => {
		const event = normalizeWebhook(
			raw(`pull_request.${action}`, {
				installation_id: "inst-1",
				repository: REPO,
				pull_request: AUTHORED_PR,
			}),
			"2026-08-16T00:00:00.000Z",
		);
		expect(event?.kind).toBe(kind);
	});

	test("the installation id rides along so a token can be minted", () => {
		// This is the ONLY place tripwire learns an open-git installation id.
		// open-git's installation.created lists repositories as bare uuids, with
		// no owner or name to build a repo row from.
		const event = normalizeWebhook(
			raw("pull_request.opened", {
				installation_id: "inst-42",
				repository: REPO,
				pull_request: AUTHORED_PR,
			}),
			"2026-08-16T00:00:00.000Z",
		);
		expect(event?.installationExternalId).toBe("inst-42");
	});

	test("an opened change request carries its author and head sha", () => {
		const event = normalizeWebhook(
			raw("pull_request.opened", {
				installation_id: "inst-1",
				repository: REPO,
				pull_request: AUTHORED_PR,
			}),
			"2026-08-16T00:00:00.000Z",
		);
		if (event?.kind !== "change-request.opened") {
			throw new Error(`expected change-request.opened, got ${event?.kind}`);
		}
		expect(event.forge).toBe("opengit");
		expect(event.actor.login).toBe("madison");
		// Username is the stable handle open-git exposes, so it doubles as the id.
		expect(event.actor.externalId).toBe("madison");
		expect(event.repo.fullName).toBe("acme/api");
		expect(event.changeRequest.number).toBe(12);
		expect(event.changeRequest.title).toBe("Fix timeout");
		expect(event.changeRequest.headSha).toBe("abc");
		expect(event.changeRequest.url).toContain("/acme/api/pulls/12");
	});

	/**
	 * The fields open-git does not send are ABSENT, never defaulted. A `""` ref
	 * or a `false` draft would read as fact in the audit trail; undefined is the
	 * truth, and the signals that want them skip (§6).
	 */
	test("branch refs and the draft flag are omitted, not invented", () => {
		const event = normalizeWebhook(
			raw("pull_request.opened", {
				repository: REPO,
				pull_request: AUTHORED_PR,
			}),
			"2026-08-16T00:00:00.000Z",
		);
		if (event?.kind !== "change-request.opened") {
			throw new Error(`expected change-request.opened, got ${event?.kind}`);
		}
		expect(event.changeRequest.baseRef).toBeUndefined();
		expect(event.changeRequest.headRef).toBeUndefined();
		expect(event.changeRequest.draft).toBeUndefined();
	});

	/**
	 * Still the actor rule: an unattributable change request is skipped, never
	 * given a placeholder. A fabricated contributor would poison scoring,
	 * moderation and the audit trail with a user who never existed.
	 */
	test.each([
		"opened",
		"edited",
		"synchronize",
		"closed",
	])("pull_request.%s with no author is not ingested", (action) => {
		const event = normalizeWebhook(
			raw(`pull_request.${action}`, {
				repository: REPO,
				pull_request: PR,
			}),
			"2026-08-16T00:00:00.000Z",
		);
		expect(event).toBeNull();
	});

	test("a change request with no head sha is not ingested", () => {
		// Nothing to pin a check to, so it cannot be gated.
		const event = normalizeWebhook(
			raw("pull_request.opened", {
				repository: REPO,
				pull_request: { ...AUTHORED_PR, head_sha: null },
			}),
			"2026-08-16T00:00:00.000Z",
		);
		expect(event).toBeNull();
	});

	test("an unmapped pull_request action is not ingested", () => {
		expect(
			normalizeWebhook(
				raw("pull_request.assigned", {
					repository: REPO,
					pull_request: AUTHORED_PR,
				}),
				"2026-08-16T00:00:00.000Z",
			),
		).toBeNull();
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
