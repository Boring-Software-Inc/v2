import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	gitCafePushEventSchema,
	normalizedEventSchema,
} from "@tripwire/contracts";
import {
	GitCafeInstallationClient,
	hydrateGitCafePushRef,
	normalizeGitCafePushRef,
} from "@tripwire/forge-gitcafe";
import installation from "../fixtures/gitcafe-action-installation-current.json";
import token from "../fixtures/gitcafe-action-token-current.json";
import members from "../fixtures/gitcafe-connection-members.json";
import repository from "../fixtures/gitcafe-connection-repository.json";
import source from "../fixtures/gitcafe-git-push-webhook.json";
import profile from "../fixtures/gitcafe-read-profile.json";
import refs from "../fixtures/gitcafe-read-refs.json";

const event = gitCafePushEventSchema.parse(source);
const actor = event.actor;
if (!actor) throw new Error("Captured push actor missing");
const update = event.git.refUpdates[0];
if (!update) throw new Error("Captured push update missing");
const credentials = {
	appId: installation.appId,
	keyId: "push-test",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};
type Route = (url: URL) => Response | Promise<Response>;
function captured(url: URL): Response {
	if (url.pathname === "/api/repos/boring/scratch")
		return Response.json(repository);
	if (url.pathname.endsWith("/members/")) return Response.json(members);
	if (url.pathname.endsWith("/collaborators/"))
		return Response.json({ items: [], next: null });
	if (url.pathname.endsWith("/users/grim")) return Response.json(profile);
	if (url.pathname.endsWith("/refs")) return Response.json(refs);
	return new Response(null, { status: 599 });
}
async function harness(
	route: Route = captured,
	guard: () => Promise<boolean> = async () => true,
) {
	const calls: string[] = [];
	const client = new GitCafeInstallationClient({
		credentials,
		lifecycleGuard: guard,
		fetch: async (url, init) => {
			expect(init.redirect).toBe("manual");
			const u = new URL(url);
			calls.push(u.pathname);
			if (u.pathname.endsWith("/access_tokens"))
				return Response.json({
					...token,
					token: "synthetic-push-token",
					expiresAt: new Date(Date.now() + 900000).toISOString(),
				});
			if (u.pathname.includes("/apps/installations/"))
				return Response.json(installation);
			return route(u);
		},
	});
	const authority = await client.getInstallation(installation.id);
	if (!authority.ok) throw new Error("Installation unavailable");
	return { client, authority: authority.value, calls };
}

test("the genuine signed push ref preserves actor and head without inventing a commit count", async () => {
	const h = await harness();
	const original = JSON.stringify(event);
	const hydrated = await hydrateGitCafePushRef(
		h.client,
		h.authority,
		event,
		update.ref,
	);
	if (!hydrated.ok) throw new Error(`Push refused: ${hydrated.reason}`);
	const result = normalizeGitCafePushRef(hydrated.value, event.createdAt);
	if (!result || result.kind !== "push")
		throw new Error("Missing normalized push");
	expect(normalizedEventSchema.safeParse(result).success).toBe(true);
	expect(result.actor.externalId).toBe(actor.id);
	expect(result.actor.login).toBe("grim");
	expect(result.push).toEqual({
		ref: update.ref,
		headSha: update.afterOid,
		commitCount: null,
	});
	expect(result.deliveryId).toBe(
		JSON.stringify([event.installation.id, event.id, update.ref]),
	);
	expect(JSON.stringify(event)).toBe(original);
});

describe("synthetic push peers and mutations, not provider fixtures", () => {
	for (const mutation of [
		"truncated",
		"count",
		"duplicate",
		"missing-actor",
		"deleted-head",
	] as const)
		test(`${mutation} cannot supply complete push evidence`, async () => {
			const changed = structuredClone(event);
			if (mutation === "truncated") changed.git.refUpdatesTruncated = true;
			if (mutation === "count") changed.git.refUpdatesCount++;
			if (mutation === "duplicate") {
				changed.git.refUpdates.push({ ...update });
				changed.git.refUpdatesCount++;
			}
			if (mutation === "missing-actor") delete changed.actor;
			if (mutation === "deleted-head")
				changed.git.refUpdates[0] = { ...update, deleted: true };
			const h = await harness();
			expect(
				(
					await hydrateGitCafePushRef(
						h.client,
						h.authority,
						changed,
						update.ref,
					)
				).ok,
			).toBe(false);
		});
	test("a current ref at another head refuses delayed delivery", async () => {
		const h = await harness((url) =>
			url.pathname.endsWith("/refs")
				? Response.json({
						...refs,
						items: refs.items.map((ref) => ({ ...ref, oid: "0".repeat(40) })),
					})
				: captured(url),
		);
		expect(
			await hydrateGitCafePushRef(h.client, h.authority, event, update.ref),
		).toEqual({ ok: false, reason: "stale-event" });
	});
	test("a deleted ref retains a null head, not an invented commit", async () => {
		const h = await harness((url) =>
			url.pathname.endsWith("/refs")
				? Response.json({ items: [], next: null })
				: captured(url),
		);
		const deleted = {
			...event,
			git: {
				...event.git,
				refUpdates: [
					{
						...update,
						beforeOid: update.afterOid,
						afterOid: null,
						created: false,
						deleted: true,
					},
				],
			},
		};
		const result = await hydrateGitCafePushRef(
			h.client,
			h.authority,
			deleted,
			update.ref,
		);
		if (!result.ok) throw new Error("Deletion refused");
		const normalized = normalizeGitCafePushRef(result.value, event.createdAt);
		expect(normalized?.kind === "push" && normalized.push.headSha).toBeNull();
	});
	test("a recreated deleted ref is stale rather than an accepted deletion", async () => {
		const h = await harness();
		const deleted = {
			...event,
			git: {
				...event.git,
				refUpdates: [
					{
						...update,
						beforeOid: update.afterOid,
						afterOid: null,
						created: false,
						deleted: true,
					},
				],
			},
		};
		expect(
			await hydrateGitCafePushRef(h.client, h.authority, deleted, update.ref),
		).toEqual({ ok: false, reason: "stale-event" });
	});
	test("a mutable handle cannot replace the signed stable actor", async () => {
		const h = await harness((url) =>
			url.pathname.endsWith("/users/grim")
				? Response.json({ ...profile, actorId: "synthetic-other-actor" })
				: captured(url),
		);
		expect(
			await hydrateGitCafePushRef(h.client, h.authority, event, update.ref),
		).toEqual({ ok: false, reason: "identity-mismatch" });
	});
	test("unknown actors are unavailable rather than guessed from the installation owner", async () => {
		const h = await harness((url) =>
			url.pathname.endsWith("/members/")
				? Response.json({ items: [], next: null })
				: captured(url),
		);
		expect(
			await hydrateGitCafePushRef(h.client, h.authority, event, update.ref),
		).toEqual({ ok: false, reason: "author-unavailable" });
	});
	test("actor lookup exhausts pages before verifying the current profile", async () => {
		const h = await harness((url) =>
			url.pathname.endsWith("/members/")
				? Response.json(
						url.searchParams.has("after")
							? members
							: {
									items: Array.from({ length: 100 }, (_, i) => ({
										actorId: `synthetic-actor-${i}`,
										handle: `synthetic-${i}`,
										avatarUrl: null,
									})),
									next: "next",
								},
					)
				: captured(url),
		);
		expect(
			(await hydrateGitCafePushRef(h.client, h.authority, event, update.ref))
				.ok,
		).toBe(true);
		expect(h.calls.filter((path) => path.endsWith("/members/"))).toHaveLength(
			2,
		);
	});
	test("a current direct collaborator can resolve identity when the organization list is unavailable", async () => {
		const h = await harness((url) =>
			url.pathname.endsWith("/members/")
				? new Response(null, { status: 403 })
				: url.pathname.endsWith("/collaborators/")
					? Response.json(members)
					: captured(url),
		);
		expect(
			(await hydrateGitCafePushRef(h.client, h.authority, event, update.ref))
				.ok,
		).toBe(true);
	});
	test("the installation bot is identified by stable actor ID without impersonating a person", async () => {
		const h = await harness();
		const self = { ...event, actor: { id: installation.bot.actorId } };
		const result = await hydrateGitCafePushRef(
			h.client,
			h.authority,
			self,
			update.ref,
		);
		if (!result.ok) throw new Error("Bot push unavailable");
		expect(result.value.author.externalId).toBe(installation.bot.actorId);
		expect(
			h.calls.some(
				(path) => path.endsWith("/members/") || path.includes("/users/"),
			),
		).toBe(false);
	});
	test("generation invalidation during a ref response refuses its result", async () => {
		const h = await harness((url) => {
			if (url.pathname.endsWith("/refs")) h.client.invalidate(installation.id);
			return captured(url);
		});
		expect(
			await hydrateGitCafePushRef(h.client, h.authority, event, update.ref),
		).toEqual({ ok: false, reason: "stale" });
	});
	test("incomplete ref pages cannot supply a current head", async () => {
		const h = await harness((url) =>
			url.pathname.endsWith("/refs")
				? Response.json({ items: refs.items })
				: captured(url),
		);
		expect(
			(await hydrateGitCafePushRef(h.client, h.authority, event, update.ref))
				.ok,
		).toBe(false);
	});
});
