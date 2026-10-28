import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	gitCafeCheckRerequestedEventSchema,
	gitCafePullEventSchema,
	gitCafePushEventSchema,
} from "@tripwire/contracts";
import {
	GitCafeInstallationClient,
	hydrateGitCafePullEvent,
	normalizeGitCafePullEvent,
} from "@tripwire/forge-gitcafe";
import rerequested from "../fixtures/gitcafe-check-rerequested-webhook.json";
import repository from "../fixtures/gitcafe-connection-repository.json";
import push from "../fixtures/gitcafe-git-push-webhook.json";
import installation from "../fixtures/gitcafe-installation.json";
import token from "../fixtures/gitcafe-installation-token.json";
import created from "../fixtures/gitcafe-pull-created-webhook.json";
import pull from "../fixtures/gitcafe-read-scratch-pull.json";

const credentials = {
	appId: installation.appId,
	keyId: "test-only",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};

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
