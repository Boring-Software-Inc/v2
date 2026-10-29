import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { gitCafeInstallationSchema } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	labelServices,
	organization,
	organizationInstallations,
	repoServices,
	repos,
	type TestDatabase,
} from "@tripwire/db";
import installation from "@tripwire/forge-gitcafe/fixtures/gitcafe-action-installation-current.json";
import token from "@tripwire/forge-gitcafe/fixtures/gitcafe-action-token-current.json";
import repository from "@tripwire/forge-gitcafe/fixtures/gitcafe-connection-repository.json";
import issues from "@tripwire/forge-gitcafe/fixtures/gitcafe-read-issues-list.json";
import pullThreads from "@tripwire/forge-gitcafe/fixtures/gitcafe-read-pulls-list.json";
import refs from "@tripwire/forge-gitcafe/fixtures/gitcafe-read-refs.json";
import pull from "@tripwire/forge-gitcafe/fixtures/gitcafe-read-scratch-pull.json";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { buildGitCafeRuntime } from "./gitcafe-runtime.ts";
import { refreshGitCafeCatalogs } from "./jobs/refresh-suggestions.ts";

let container: TestDatabase;
let database: ReturnType<typeof createDb>;
let repoId: string;
let failure: "refs" | "labels" | null;
let reads: string[];
let onRead: ((path: string) => Promise<void>) | null;
let repositoryResponse = { ...repository };
let installationResponse = gitCafeInstallationSchema.parse(installation);
const messages: string[] = [];
const logger = pino(
	{ level: "warn" },
	{
		write: (message) => {
			messages.push(message);
		},
	},
);
const credentials = {
	appId: installation.appId,
	keyId: "catalog-test",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};

beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
}, 120_000);
beforeEach(async () => {
	await database.db.execute(
		sql`TRUNCATE repos, organization, gitcafe_installation_lifecycle CASCADE`,
	);
	const orgId = generateId();
	repoId = generateId();
	failure = null;
	reads = [];
	onRead = null;
	repositoryResponse = { ...repository };
	installationResponse = gitCafeInstallationSchema.parse(installation);
	messages.length = 0;
	await database.db
		.insert(organization)
		.values({ id: orgId, name: "Catalog test", slug: `catalog-${orgId}` });
	await database.db.insert(organizationInstallations).values({
		id: generateId(),
		forge: "gitcafe",
		installationId: installation.id,
		organizationId: orgId,
		accountLogin: installation.org,
	});
	await database.db.insert(repos).values({
		id: repoId,
		forge: "gitcafe",
		externalId: repository.id,
		owner: repository.owner,
		name: repository.name,
		fullName: "boring/scratch",
		installationId: installation.id,
		orgId,
		armed: false,
	});
	await database.db.insert(gitCafeInstallationLifecycle).values({
		installationId: installation.id,
		status: "active",
		generation: 1,
		authorityAt: new Date(),
	});
	await repoServices.upsertRepoSuggestions(database.db, repoId, "branches", [
		"previous",
	]);
	await labelServices.replaceRepoLabels(database.db, repoId, [
		{ name: "previous", color: "123456", description: null },
	]);
});
afterAll(async () => {
	await database?.pool.end();
	await container?.stop();
});

function runtime() {
	return buildGitCafeRuntime(database.db, credentials, async (url, init) => {
		const path = new URL(url).pathname;
		reads.push(path);
		await onRead?.(path);
		if (path.includes("/apps/installations/"))
			return Response.json(
				init.method === "GET"
					? installationResponse
					: {
							...token,
							token: "synthetic-catalog-token",
							expiresAt: new Date(Date.now() + 900_000).toISOString(),
						},
			);
		if (failure && path.endsWith(`/${failure}`))
			return new Response("private-provider-body", { status: 503 });
		if (path === "/api/repos/boring/scratch")
			return Response.json(repositoryResponse);
		if (path.endsWith("/refs")) return Response.json(refs);
		if (path.endsWith("/labels"))
			return Response.json({ items: [], next: null });
		if (path.endsWith("/pulls/")) return Response.json(pullThreads);
		if (path.endsWith("/issues/")) return Response.json(issues);
		if (path.endsWith("/pulls/1")) return Response.json(pull);
		if (path.endsWith("/issues/2")) return Response.json(issues.items[0]);
		return new Response(null, { status: 599 });
	});
}

test("claimed unarmed repositories can refresh complete catalogs without enabling protection", async () => {
	expect(
		await refreshGitCafeCatalogs(
			{ db: database.db, runtime: runtime(), logger },
			{ repoId, requestId: generateId() },
		),
	).toEqual({ ok: true });
	expect(
		await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
	).toEqual(["main", "tripwire-qa/adapter-20261028"]);
	expect(
		(await labelServices.listRepoLabels(database.db, repoId)).labels,
	).toEqual([]);
	expect((await repoServices.getRepoById(database.db, repoId))?.armed).toBe(
		false,
	);
});

for (const source of ["refs", "labels"] as const)
	test(`${source} failure preserves that cache while healthy sources refresh and retry recovers`, async () => {
		failure = source;
		const requestId = generateId();
		expect(
			await refreshGitCafeCatalogs(
				{ db: database.db, runtime: runtime(), logger },
				{ repoId, requestId },
			),
		).toEqual({ ok: false });
		expect(
			await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
		).toEqual(
			source === "refs"
				? ["previous"]
				: ["main", "tripwire-qa/adapter-20261028"],
		);
		expect(
			(await labelServices.listRepoLabels(database.db, repoId)).labels.map(
				(label) => label.name,
			),
		).toEqual(source === "labels" ? ["previous"] : []);
		expect(messages.join("")).toContain(requestId);
		expect(messages.join("")).not.toContain("private-provider-body");
		failure = null;
		expect(
			await refreshGitCafeCatalogs(
				{ db: database.db, runtime: runtime(), logger },
				{ repoId, requestId },
			),
		).toEqual({ ok: true });
	});

test("the runtime lists current issue and PR identities through the claimed installation", async () => {
	const list = runtime().listThreads;
	if (!list) throw new Error("Missing GitCafe thread reader");
	const result = await list("boring/scratch", {
		subjects: ["issue", "change-request"],
		state: "any",
		updatedBefore: null,
		labels: [],
		excludeLabels: [],
		skipLocked: false,
		cap: 100,
	});
	if (!("ok" in result) || !result.ok) throw new Error("Thread read failed");
	const issueAuthor = issues.items[0]?.authorActorId;
	if (!issueAuthor) throw new Error("Captured issue author is missing");
	expect(
		result.value.threads.map((thread) => [
			thread.kind,
			thread.number,
			thread.authorExternalId,
		]),
	).toEqual([
		["change-request", 1, pull.authorActorId],
		["issue", 2, issueAuthor],
	]);
});

test("revoked authority preserves caches without issuing provider requests", async () => {
	await database.db
		.update(gitCafeInstallationLifecycle)
		.set({ status: "paused", generation: 2 })
		.where(eq(gitCafeInstallationLifecycle.installationId, installation.id));
	expect(
		await refreshGitCafeCatalogs(
			{ db: database.db, runtime: runtime(), logger },
			{ repoId, requestId: generateId() },
		),
	).toEqual({ ok: false });
	expect(reads).toEqual([]);
	expect(
		await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
	).toEqual(["previous"]);
	expect(
		(await labelServices.listRepoLabels(database.db, repoId)).labels,
	).toHaveLength(1);
});

test("a general forge job cannot make the isolated catalog consumer call GitCafe", async () => {
	await database.db
		.update(repos)
		.set({ forge: "github" })
		.where(eq(repos.id, repoId));
	expect(
		await refreshGitCafeCatalogs(
			{ db: database.db, runtime: runtime(), logger },
			{ repoId, requestId: generateId() },
		),
	).toEqual({ ok: true });
	expect(reads).toEqual([]);
});

for (const change of ["pause", "disconnect"] as const)
	test(`${change} during enumeration refuses all cache writes`, async () => {
		onRead = async (path) => {
			if (!path.endsWith(change === "pause" ? "/labels" : "/refs")) return;
			onRead = null;
			if (change === "pause")
				await gitCafeLifecycleServices.retireGitCafeInstallation(database.db, {
					installationId: installation.id,
					reason: "paused",
				});
			else
				await repoServices.removeInstallation(
					database.db,
					"gitcafe",
					installation.id,
				);
		};
		expect(
			await refreshGitCafeCatalogs(
				{ db: database.db, runtime: runtime(), logger },
				{ repoId, requestId: generateId() },
			),
		).toEqual({ ok: false });
		expect(
			await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
		).toEqual(["previous"]);
		expect(
			(await labelServices.listRepoLabels(database.db, repoId)).labels.map(
				(label) => label.name,
			),
		).toEqual(["previous"]);
	});

test("a valid read cannot commit after its installation generation is retired", async () => {
	const result = await runtime().getCatalogs(repoId);
	if (!result.ok) throw new Error("Expected healthy catalogs");
	await gitCafeLifecycleServices.retireGitCafeInstallation(database.db, {
		installationId: installation.id,
		reason: "paused",
	});
	expect(
		await gitCafeLifecycleServices.commitGitCafeCatalogs(
			database.db,
			result.value.binding,
			{ branches: ["must-not-publish"], labels: [] },
		),
	).toBe(false);
	expect(
		await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
	).toEqual(["previous"]);
	expect(
		(await labelServices.listRepoLabels(database.db, repoId)).labels,
	).toHaveLength(1);
});

test("a changed repository identity cannot commit a previously valid catalog read", async () => {
	const result = await runtime().getCatalogs(repoId);
	if (!result.ok) throw new Error("Expected healthy catalogs");
	await database.db
		.update(repos)
		.set({ externalId: "replacement-repository", fullName: "boring/renamed" })
		.where(eq(repos.id, repoId));
	expect(
		await gitCafeLifecycleServices.commitGitCafeCatalogs(
			database.db,
			result.value.binding,
			{ branches: ["must-not-publish"], labels: [] },
		),
	).toBe(false);
	expect(
		await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
	).toEqual(["previous"]);
});

test("name reuse before binding cannot put replacement catalogs into the original row", async () => {
	const read = repoServices.getRepoById;
	let changed = false;
	const lookup = spyOn(repoServices, "getRepoById").mockImplementation(
		async (...args) => {
			const row = await read(...args);
			if (!changed && row?.id === repoId) {
				changed = true;
				await database.db
					.update(repos)
					.set({ name: "renamed", fullName: "boring/renamed" })
					.where(eq(repos.id, repoId));
				repositoryResponse = { ...repository, id: "synthetic-replacement-id" };
				await database.db.insert(repos).values({
					id: generateId(),
					forge: "gitcafe",
					externalId: repositoryResponse.id,
					owner: "boring",
					name: "scratch",
					fullName: "boring/scratch",
					installationId: installation.id,
					orgId: row.orgId,
				});
			}
			return row;
		},
	);
	try {
		expect(
			await refreshGitCafeCatalogs(
				{ db: database.db, runtime: runtime(), logger },
				{ repoId, requestId: generateId() },
			),
		).toEqual({ ok: false });
		expect(
			await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
		).toEqual(["previous"]);
		expect(
			(await labelServices.listRepoLabels(database.db, repoId)).labels,
		).toHaveLength(1);
	} finally {
		lookup.mockRestore();
	}
});

for (const change of ["paused", "revision"] as const)
	test(`provider ${change} after branches completes invalidates the catalog bundle`, async () => {
		onRead = async (path) => {
			if (!path.endsWith("/labels")) return;
			onRead = null;
			installationResponse =
				change === "paused"
					? { ...installationResponse, pausedAt: new Date().toISOString() }
					: {
							...installationResponse,
							revision: installationResponse.revision + 1,
						};
		};
		expect(
			await refreshGitCafeCatalogs(
				{ db: database.db, runtime: runtime(), logger },
				{ repoId, requestId: generateId() },
			),
		).toEqual({ ok: false });
		expect(
			await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
		).toEqual(["previous"]);
		expect(
			(await labelServices.listRepoLabels(database.db, repoId)).labels,
		).toHaveLength(1);
	});

for (const field of ["providerVersion", "providerRevision"] as const)
	test(`a provider response older than persisted ${field} cannot publish catalogs`, async () => {
		await database.db
			.update(gitCafeInstallationLifecycle)
			.set({ [field]: 3 })
			.where(eq(gitCafeInstallationLifecycle.installationId, installation.id));
		expect(
			await refreshGitCafeCatalogs(
				{ db: database.db, runtime: runtime(), logger },
				{ repoId, requestId: generateId() },
			),
		).toEqual({ ok: false });
		expect(
			await repoServices.getRepoSuggestions(database.db, repoId, "branches"),
		).toEqual(["previous"]);
		expect(
			(await labelServices.listRepoLabels(database.db, repoId)).labels,
		).toHaveLength(1);
		expect(
			reads.some((path) => path.endsWith("/refs") || path.endsWith("/labels")),
		).toBe(false);
	});
