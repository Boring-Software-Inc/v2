import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { normalizedEventSchema } from "@tripwire/contracts";
import { normalizeWebhook } from "./normalize.ts";
import { signWebhookBody, verifyWebhookSignature } from "./verify.ts";

const NOW = "2026-07-11T00:00:00.000Z";

async function fixture(name: string): Promise<string> {
	// `fileURLToPath`, not `.pathname`: on Windows the latter yields "/C:/..."
	// with a leading slash, which no fs call accepts.
	const path = fileURLToPath(
		new URL(`../../fixtures/${name}.json`, import.meta.url),
	);
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

	test("a contributor comment carrying the marker is not Tripwire's own", async () => {
		const raw = JSON.parse(await fixture("issue_comment.created"));
		raw.comment.body = "spam <!-- tripwire:run -->";
		const event = normalizeWebhook(
			{
				deliveryId: "d-4b",
				eventName: "issue_comment",
				body: JSON.stringify(raw),
				signature: null,
			},
			NOW,
		);
		if (event?.kind !== "comment.created") {
			throw new Error("unreachable");
		}
		expect(event.comment.byTripwire).toBe(false);
	});

	test("an app-authored comment carrying the marker is Tripwire's own", async () => {
		const raw = JSON.parse(await fixture("issue_comment.created"));
		raw.comment.body = "Blocked. <!-- tripwire:run -->";
		raw.comment.performed_via_github_app = { id: 4291944, slug: "tripwire-sh" };
		raw.sender = { ...raw.sender, login: "tripwire-sh[bot]", type: "Bot" };
		const event = normalizeWebhook(
			{
				deliveryId: "d-4c",
				eventName: "issue_comment",
				body: JSON.stringify(raw),
				signature: null,
			},
			NOW,
		);
		if (event?.kind !== "comment.created") {
			throw new Error("unreachable");
		}
		expect(event.comment.byTripwire).toBe(true);
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

function normalizeFixture(body: string, deliveryId: string) {
	return normalizeWebhook(
		{ deliveryId, eventName: "pull_request", body, signature: null },
		NOW,
	);
}

describe("normalizeWebhook — pull_request edits (self-captured fixtures)", () => {
	test("a retarget re-runs Tripwire on the new base", async () => {
		const event = normalizeFixture(
			await fixture("pull_request.edited.base"),
			"d-edit-base",
		);
		expect(event?.kind).toBe("change-request.updated");
		if (event?.kind !== "change-request.updated") {
			throw new Error("unreachable");
		}
		expect(event.changeRequest.baseRef).toBe("main");
		expect(event.changeRequest.headSha).toMatch(/^[0-9a-f]{40}$/);
		expect(normalizedEventSchema.parse(event)).toBeTruthy();
	});

	test("a retarget by a bot still re-runs, because the base is a rule input", async () => {
		const raw = JSON.parse(await fixture("pull_request.edited.base"));
		expect(raw.sender.type).toBe("Bot");
		expect(normalizeFixture(JSON.stringify(raw), "d-edit-base-bot")?.kind).toBe(
			"change-request.updated",
		);
	});

	test("the contributor's own title edit re-runs Tripwire", async () => {
		const event = normalizeFixture(
			await fixture("pull_request.edited.title"),
			"d-edit-title",
		);
		expect(event?.kind).toBe("change-request.updated");
		if (event?.kind !== "change-request.updated") {
			throw new Error("unreachable");
		}
		expect(event.changeRequest.title).toBe(
			"fix: restore flat direct mail-row actions [skip release]",
		);
	});

	test("a bot rewriting the description does not re-run Tripwire", async () => {
		expect(
			normalizeFixture(
				await fixture("pull_request.edited.body-by-bot"),
				"d-edit-body-bot",
			),
		).toBeNull();
	});

	test("the same description edit by a person re-runs Tripwire", async () => {
		const raw = JSON.parse(await fixture("pull_request.edited.body-by-bot"));
		raw.sender = raw.pull_request.user;
		expect(normalizeFixture(JSON.stringify(raw), "d-edit-body")?.kind).toBe(
			"change-request.updated",
		);
	});

	test("an edit to a closed change request does not re-run Tripwire", async () => {
		const raw = JSON.parse(await fixture("pull_request.edited.base"));
		raw.pull_request.state = "closed";
		expect(normalizeFixture(JSON.stringify(raw), "d-edit-closed")).toBeNull();
	});

	test("an edit that touches no rule input is not ingested", async () => {
		const raw = JSON.parse(await fixture("pull_request.edited.title"));
		raw.changes = {};
		expect(normalizeFixture(JSON.stringify(raw), "d-edit-none")).toBeNull();
	});
});

describe("normalizeWebhook — the contributor is the PR author", () => {
	test("a bot retargeting someone else's PR leaves the author as the actor", async () => {
		const event = normalizeFixture(
			await fixture("pull_request.edited.base"),
			"d-author",
		);
		expect(event?.actor.login).toBe("hovanessb");
		expect(event && "repo" in event ? event.sender?.login : null).toBe(
			"github-actions[bot]",
		);
	});

	test("every pull_request fixture carries its author as the actor", async () => {
		for (const name of [
			"pull_request.opened",
			"pull_request.synchronize",
			"pull_request.closed",
			"pull_request.edited.title",
		]) {
			const body = await fixture(name);
			const raw = JSON.parse(body);
			const event = normalizeFixture(body, `d-${name}`);
			expect(event?.actor.login).toBe(raw.pull_request.user.login);
			expect(event?.actor.externalId).toBe(String(raw.pull_request.user.id));
			expect(event && "repo" in event ? event.sender?.login : null).toBe(
				raw.sender.login,
			);
		}
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
