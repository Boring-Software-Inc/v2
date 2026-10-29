import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	gitCafeCheckRerequestedEventSchema,
	gitCafeCommentEventSchema,
	gitCafePullEventSchema,
	gitCafePushEventSchema,
} from "@tripwire/contracts";
import {
	GitCafeInstallationClient,
	hydrateGitCafeCommentEvent,
	hydrateGitCafePullEvent,
	normalizeGitCafeCommentEvent,
	normalizeGitCafePullEvent,
} from "@tripwire/forge-gitcafe";
import rerequested from "../fixtures/gitcafe-check-rerequested-webhook.json";
import repository from "../fixtures/gitcafe-connection-repository.json";
import push from "../fixtures/gitcafe-git-push-webhook.json";
import installation from "../fixtures/gitcafe-installation.json";
import token from "../fixtures/gitcafe-installation-token.json";
import issueComment from "../fixtures/gitcafe-issue-comment-created-webhook.json";
import pullComment from "../fixtures/gitcafe-pull-comment-created-webhook.json";
import created from "../fixtures/gitcafe-pull-created-webhook.json";
import issue from "../fixtures/gitcafe-read-issue.json";
import issueComments from "../fixtures/gitcafe-read-issue-comments.json";
import commentDetail from "../fixtures/gitcafe-read-pull-comment-detail.json";
import pull from "../fixtures/gitcafe-read-scratch-pull.json";

const credentials = {
	appId: installation.appId,
	keyId: "test-only",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};

/** Synthetic transport changes captured responses; pagination mutations are adversarial cases, not provider fixtures. */
function commentHarness(
	options: {
		detail?: unknown;
		page?: (url: URL) => unknown;
		subject?: unknown;
		guard?: () => Promise<boolean>;
		onRead?: (url: string) => void;
	} = {},
) {
	const calls: string[] = [];
	const expected = { ...installation, id: pullComment.installation.id };
	const client = new GitCafeInstallationClient({
		credentials,
		now: () => Date.parse(token.expiresAt) - 900_000,
		lifecycleGuard: options.guard ?? (async () => true),
		fetch: async (url, init) => {
			calls.push(url);
			options.onRead?.(url);
			expect(init.redirect).toBe("manual");
			if (url.endsWith("/access_tokens"))
				return Response.json({
					...token,
					token: "synthetic-test-bearer",
					installationId: expected.id,
					actor: expected.bot.actorId,
				});
			if (url.includes("/apps/installations/")) return Response.json(expected);
			if (url.endsWith("/repos/boring/scratch"))
				return Response.json(repository);
			if (url.endsWith("/pulls/1"))
				return Response.json(options.subject ?? pull);
			if (url.endsWith("/issues/2"))
				return Response.json(options.subject ?? issue);
			if (url.endsWith("/detail"))
				return Response.json(options.detail ?? commentDetail);
			if (url.includes("/issues/2/comments/?"))
				return Response.json(options.page?.(new URL(url)) ?? issueComments);
			throw new Error("Unexpected comment transport request");
		},
	});
	return { client, calls, expected };
}

for (const captured of [pullComment, issueComment]) {
	test(`captured ${captured.type} binds its live author and preserves raw evidence`, async () => {
		const h = commentHarness();
		const lookup = await h.client.getInstallation(captured.installation.id);
		if (!lookup.ok) throw new Error("lookup failed");
		const before = JSON.stringify(captured);
		const result = await hydrateGitCafeCommentEvent(
			h.client,
			lookup.value,
			gitCafeCommentEventSchema.parse(captured),
		);
		if (!result.ok)
			throw new Error(`comment hydration failed: ${result.reason}`);
		const normalized = normalizeGitCafeCommentEvent(
			result.value,
			captured.createdAt,
		);
		expect(normalized).toMatchObject({
			kind: "comment.created",
			forge: "gitcafe",
			repoExternalId: repository.id,
			actor: { login: "grim", externalId: captured.comment.authorActorId },
			comment: {
				externalId: captured.comment.id,
				body: captured.comment.body,
				subjectKind:
					captured.type === "pull.comment_created" ? "change-request" : "issue",
				subjectNumber: captured.type === "pull.comment_created" ? 1 : 2,
				byTripwire: false,
			},
		});
		expect(normalized?.deliveryId).toBe(
			JSON.stringify([captured.installation.id, captured.id]),
		);
		expect(JSON.stringify(captured)).toBe(before);
	});
}

test("comment hydration remains valid when its PR head, version or author differs", async () => {
	const h = commentHarness({
		subject: {
			...pull,
			headOid: "a".repeat(40),
			version: 9,
			authorActorId: "another-author",
		},
	});
	const lookup = await h.client.getInstallation(pullComment.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	const event = gitCafeCommentEventSchema.parse({
		...pullComment,
		actor: { id: "unrelated-sender" },
	});
	const result = await hydrateGitCafeCommentEvent(
		h.client,
		lookup.value,
		event,
	);
	if (!result.ok) throw new Error(`comment hydration failed: ${result.reason}`);
	const normalized = normalizeGitCafeCommentEvent(
		result.value,
		event.createdAt,
	);
	if (!normalized || !("comment" in normalized))
		throw new Error("Missing comment");
	if (event.comment.authorActorId === null)
		throw new Error("Missing captured author");
	expect(normalized.actor.externalId).toBe(event.comment.authorActorId);
	expect(normalized.sender).toBeUndefined();
	expect(normalized.comment.url).toBe("https://git.cafe/boring/scratch/pull/1");
});

for (const change of [
	{ hiddenAt: "2026-10-29T02:00:00.000Z" },
	{ deletedAt: "2026-10-29T02:00:00.000Z" },
	{ body: "changed" },
	{ version: 7 },
	{ authorActorId: "another-actor" },
	{ author: { ...commentDetail.author, actorId: "another-actor" } },
	{ author: { ...commentDetail.author, handle: null } },
	{ id: "another-comment" },
]) {
	test(`refuses changed or unavailable comment evidence ${Object.keys(change).join()}`, async () => {
		const h = commentHarness({ detail: { ...commentDetail, ...change } });
		const lookup = await h.client.getInstallation(pullComment.installation.id);
		if (!lookup.ok) throw new Error("lookup failed");
		expect(
			(
				await hydrateGitCafeCommentEvent(
					h.client,
					lookup.value,
					gitCafeCommentEventSchema.parse(pullComment),
				)
			).ok,
		).toBe(false);
	});
}

test("signed truncated, hidden, deleted or missing comment bodies never become rule evidence", async () => {
	const h = commentHarness();
	const lookup = await h.client.getInstallation(pullComment.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	for (const change of [
		{ bodyTruncated: true },
		{ hidden: true },
		{ deleted: true },
		{ body: null },
	]) {
		expect(
			await hydrateGitCafeCommentEvent(
				h.client,
				lookup.value,
				gitCafeCommentEventSchema.parse({
					...pullComment,
					comment: { ...pullComment.comment, ...change },
				}),
			),
		).toEqual({ ok: false, reason: "stale-event" });
	}
	expect(h.calls.some((url) => url.includes("/repos/"))).toBe(false);
});

test("issue hydration exhausts pages even when the matching comment was on the first page", async () => {
	const h = commentHarness({
		page: (url) =>
			url.searchParams.has("after")
				? { items: [], next: null }
				: { ...issueComments, next: "next-page" },
	});
	const lookup = await h.client.getInstallation(issueComment.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	const result = await hydrateGitCafeCommentEvent(
		h.client,
		lookup.value,
		gitCafeCommentEventSchema.parse(issueComment),
	);
	expect(result.ok).toBe(true);
	expect(
		h.calls.filter((url) => url.includes("/issues/2/comments/?")),
	).toHaveLength(2);
});

for (const page of [
	() => ({ ...issueComments, next: "loop" }),
	(url: URL) =>
		url.searchParams.has("after")
			? issueComments
			: { ...issueComments, next: "next-page" },
	() => ({
		items: issueComments.items.map((comment) => ({
			...comment,
			issueId: "another-issue",
		})),
		next: null,
	}),
	() => ({ items: [], next: null }),
	() => ({ items: issueComments.items }),
]) {
	test("incomplete, missing, repeated or misbound issue comment pages refuse", async () => {
		const h = commentHarness({ page });
		const lookup = await h.client.getInstallation(issueComment.installation.id);
		if (!lookup.ok) throw new Error("lookup failed");
		expect(
			(
				await hydrateGitCafeCommentEvent(
					h.client,
					lookup.value,
					gitCafeCommentEventSchema.parse(issueComment),
				)
			).ok,
		).toBe(false);
	});
}

test("comment authority revoked during detail read refuses the resulting evidence", async () => {
	let allowed = true;
	const h = commentHarness({
		guard: async () => allowed,
		onRead: (url) => {
			if (url.endsWith("/detail")) allowed = false;
		},
	});
	const lookup = await h.client.getInstallation(pullComment.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	expect(
		(
			await hydrateGitCafeCommentEvent(
				h.client,
				lookup.value,
				gitCafeCommentEventSchema.parse(pullComment),
			)
		).ok,
	).toBe(false);
});

test("Tripwire bot comments are identified by the bound actor, not a marker in their body", async () => {
	const expected = commentHarness().expected;
	const author = {
		...commentDetail.author,
		actorId: expected.bot.actorId,
		handle: expected.bot.handle,
	};
	const h = commentHarness({
		detail: { ...commentDetail, author, authorActorId: expected.bot.actorId },
	});
	const lookup = await h.client.getInstallation(pullComment.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	const event = gitCafeCommentEventSchema.parse({
		...pullComment,
		actor: { id: expected.bot.actorId },
		comment: { ...pullComment.comment, authorActorId: expected.bot.actorId },
	});
	const result = await hydrateGitCafeCommentEvent(
		h.client,
		lookup.value,
		event,
	);
	if (!result.ok) throw new Error(`comment hydration failed: ${result.reason}`);
	const normalized = normalizeGitCafeCommentEvent(
		result.value,
		event.createdAt,
	);
	if (!normalized || !("comment" in normalized))
		throw new Error("Missing comment");
	expect(normalized.comment.byTripwire).toBe(true);
	expect(normalized.sender?.externalId).toBe(expected.bot.actorId);
});

for (const subject of [
	{ ...pull, id: "another-subject" },
	{ ...pull, repoId: "another-repository" },
	{ ...pull, number: 2 },
]) {
	test("comment subject identity is bound before reading the comment", async () => {
		const h = commentHarness({ subject });
		const lookup = await h.client.getInstallation(pullComment.installation.id);
		if (!lookup.ok) throw new Error("lookup failed");
		expect(
			await hydrateGitCafeCommentEvent(
				h.client,
				lookup.value,
				gitCafeCommentEventSchema.parse(pullComment),
			),
		).toEqual({ ok: false, reason: "identity-mismatch" });
		expect(h.calls.some((url) => url.endsWith("/detail"))).toBe(false);
	});
}

test("comment hydration requires an original snapshot and an unexpired deadline", async () => {
	const h = commentHarness();
	const lookup = await h.client.getInstallation(pullComment.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	const event = gitCafeCommentEventSchema.parse(pullComment);
	expect(
		(await hydrateGitCafeCommentEvent(h.client, { ...lookup.value }, event)).ok,
	).toBe(false);
	expect(
		await hydrateGitCafeCommentEvent(h.client, lookup.value, event, 0),
	).toEqual({ ok: false, reason: "expired" });
	expect(h.calls.some((url) => url.includes("/repos/"))).toBe(false);
});

test("comment normalization rejects identities not bound to the signed event", () => {
	const event = gitCafeCommentEventSchema.parse(pullComment);
	const hydrated = {
		event,
		author: { login: "grim", externalId: pullComment.comment.authorActorId },
		botActorId: installation.bot.actorId,
	};
	expect(() =>
		normalizeGitCafeCommentEvent(
			{ ...hydrated, author: { login: "wrong", externalId: "wrong-actor" } },
			event.createdAt,
		),
	).toThrow();
	expect(() =>
		normalizeGitCafeCommentEvent(
			{ ...hydrated, sender: { login: "wrong", externalId: "wrong-actor" } },
			event.createdAt,
		),
	).toThrow();
	expect(
		gitCafeCommentEventSchema.safeParse({
			...event,
			commentId: "another-comment",
		}).success,
	).toBe(false);
});

/** Synthetic transport mutates captured evidence to exercise refusal paths; it is not a provider fixture. */
function harness(
	options: {
		pull?: unknown;
		repository?: unknown;
		guard?: () => Promise<boolean>;
	} = {},
) {
	const calls: string[] = [];
	const expected = {
		...installation,
		id: created.installation.id,
		bot: { ...installation.bot, actorId: rerequested.bot.id },
	};
	const client = new GitCafeInstallationClient({
		credentials,
		now: () => Date.parse(token.expiresAt) - 900_000,
		lifecycleGuard: options.guard ?? (async () => true),
		fetch: async (url, init) => {
			calls.push(url);
			expect(init.redirect).toBe("manual");
			if (url.endsWith("/access_tokens"))
				return Response.json({
					...token,
					token: "synthetic-test-bearer",
					installationId: expected.id,
					actor: expected.bot.actorId,
				});
			if (url.includes("/apps/installations/")) return Response.json(expected);
			if (url.endsWith("/pulls/1")) return Response.json(options.pull ?? pull);
			if (url.endsWith("/repos/boring/scratch"))
				return Response.json(options.repository ?? repository);
			throw new Error("Unexpected transport request");
		},
	});
	return { client, calls };
}

test("three genuine app-delivery captures parse without implying successful ingress", () => {
	expect(gitCafePullEventSchema.parse(created).pull.id).toBe(pull.id);
	expect(
		gitCafeCheckRerequestedEventSchema.parse(rerequested).checkRun.headOid,
	).toBe(pull.headOid);
	expect(gitCafePushEventSchema.parse(push).git.refUpdatesCount).toBe(1);
	expect("commitCount" in gitCafePushEventSchema.parse(push).git).toBe(false);
});

test("hydrates captured PR author and normalizes without modifying the signed event", async () => {
	const h = harness();
	const lookup = await h.client.getInstallation(created.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	const before = JSON.stringify(created);
	const hydrated = await hydrateGitCafePullEvent(
		h.client,
		lookup.value,
		gitCafePullEventSchema.parse(created),
	);
	if (!hydrated.ok) throw new Error(`hydration failed: ${hydrated.reason}`);
	const normalized = normalizeGitCafePullEvent(
		hydrated.value,
		created.createdAt,
	);
	expect(normalized).toMatchObject({
		forge: "gitcafe",
		kind: "change-request.opened",
		repoExternalId: repository.id,
		installationExternalId: created.installation.id,
		actor: { login: pull.author.handle, externalId: pull.authorActorId },
		changeRequest: {
			headSha: pull.headOid,
			baseRef: pull.targetBranch,
			headRef: pull.sourceBranch,
			number: 1,
			url: "https://git.cafe/boring/scratch/pulls/1",
		},
	});
	expect(JSON.stringify(created)).toBe(before);
	expect(normalized?.deliveryId).toBe(
		JSON.stringify([created.installation.id, created.id]),
	);
});

test("bot-caused updates retain the contributor author and identify the bot separately", async () => {
	const h = harness();
	const lookup = await h.client.getInstallation(created.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	const result = await hydrateGitCafePullEvent(
		h.client,
		lookup.value,
		gitCafePullEventSchema.parse({
			...created,
			actor: { id: lookup.value.bot.actorId },
			type: "pull.updated",
		}),
	);
	if (!result.ok) throw new Error("hydration failed");
	expect(result.value.author.externalId).toBe(pull.authorActorId);
	expect(result.value.sender).toEqual({
		login: lookup.value.bot.handle,
		externalId: lookup.value.bot.actorId,
	});
});

for (const field of [
	"headOid",
	"version",
	"title",
	"sourceBranch",
	"targetBranch",
	"state",
	"draft",
] as const) {
	test(`a changed current ${field} cannot evaluate an older event`, async () => {
		const changed = {
			...pull,
			[field]:
				field === "version"
					? 1
					: field === "draft"
						? true
						: field === "state"
							? "closed"
							: field === "headOid"
								? "a".repeat(40)
								: "changed",
		};
		const h = harness({ pull: changed });
		const lookup = await h.client.getInstallation(created.installation.id);
		if (!lookup.ok) throw new Error("lookup failed");
		expect(
			await hydrateGitCafePullEvent(
				h.client,
				lookup.value,
				gitCafePullEventSchema.parse(created),
			),
		).toEqual({ ok: false, reason: "stale-event" });
	});
}

for (const changed of [
	{ ...pull, id: "different" },
	{ ...pull, repoId: "different" },
	{ ...pull, authorActorId: "different" },
]) {
	test("PR, repo and author identity changes refuse", async () => {
		const h = harness({ pull: changed });
		const lookup = await h.client.getInstallation(created.installation.id);
		if (!lookup.ok) throw new Error("lookup failed");
		expect(
			await hydrateGitCafePullEvent(
				h.client,
				lookup.value,
				gitCafePullEventSchema.parse(created),
			),
		).toEqual({ ok: false, reason: "identity-mismatch" });
	});
}

test("a reused repository name does not authorize an event for another stable repo ID", async () => {
	const h = harness({ repository: { ...repository, id: "different" } });
	const lookup = await h.client.getInstallation(created.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	expect(
		await hydrateGitCafePullEvent(
			h.client,
			lookup.value,
			gitCafePullEventSchema.parse(created),
		),
	).toEqual({ ok: false, reason: "identity-mismatch" });
	expect(h.calls.some((url) => url.endsWith("/pulls/1"))).toBe(false);
});

test("missing author identity is unavailable, never the sender's identity", async () => {
	const h = harness({
		pull: { ...pull, author: { ...pull.author, handle: null } },
	});
	const lookup = await h.client.getInstallation(created.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	expect(
		await hydrateGitCafePullEvent(
			h.client,
			lookup.value,
			gitCafePullEventSchema.parse(created),
		),
	).toEqual({ ok: false, reason: "author-unavailable" });
});

test("local authority revocation refuses before the protected PR read", async () => {
	let allowed = true;
	const h = harness({ guard: async () => allowed });
	const lookup = await h.client.getInstallation(created.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	allowed = false;
	expect(
		(
			await hydrateGitCafePullEvent(
				h.client,
				lookup.value,
				gitCafePullEventSchema.parse(created),
			)
		).ok,
	).toBe(false);
	expect(h.calls.some((url) => url.endsWith("/pulls/1"))).toBe(false);
});

test("copied installation snapshots cannot acquire protected identity", async () => {
	const h = harness();
	const lookup = await h.client.getInstallation(created.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	expect(
		(
			await hydrateGitCafePullEvent(
				h.client,
				{ ...lookup.value },
				gitCafePullEventSchema.parse(created),
			)
		).ok,
	).toBe(false);
	expect(h.calls.some((url) => url.endsWith("/pulls/1"))).toBe(false);
});

test("normalization rejects an author or sender that is not bound to the signed IDs", () => {
	const author = { login: pull.author.handle, externalId: pull.authorActorId };
	expect(() =>
		normalizeGitCafePullEvent(
			{
				event: gitCafePullEventSchema.parse(created),
				author: { ...author, externalId: "different" },
			},
			created.createdAt,
		),
	).toThrow();
	expect(() =>
		normalizeGitCafePullEvent(
			{
				event: gitCafePullEventSchema.parse(created),
				author,
				sender: { ...author, externalId: "different" },
			},
			created.createdAt,
		),
	).toThrow();
});

test("normalization maps lifecycle kinds without manufacturing an unavailable head", () => {
	const author = { login: pull.author.handle, externalId: pull.authorActorId };
	for (const [type, kind] of [
		["pull.reopened", "change-request.opened"],
		["pull.updated", "change-request.updated"],
		["pull.synchronized", "change-request.updated"],
		["pull.drafted", "change-request.updated"],
		["pull.ready", "change-request.updated"],
		["pull.closed", "change-request.closed"],
		["pull.merged", "change-request.closed"],
	] as const) {
		const event = gitCafePullEventSchema.parse({ ...created, type });
		expect(
			normalizeGitCafePullEvent({ event, author }, created.createdAt)?.kind,
		).toBe(kind);
	}
	const event = gitCafePullEventSchema.parse({
		...created,
		pull: { ...created.pull, headOid: null },
	});
	expect(
		normalizeGitCafePullEvent({ event, author }, created.createdAt),
	).toBeNull();
});
