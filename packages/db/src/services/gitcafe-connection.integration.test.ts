import { afterAll, beforeAll, expect, test } from "bun:test";
import type {
	GitCafeConnectionJob,
	GitCafeConnectionRepository,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type TestDatabase,
} from "../index.ts";
import { session, user } from "../schema/auth.ts";
import { member, organization } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { commitGitCafeConnection } from "./gitcafe-connection.ts";

let container: TestDatabase;
let database: ReturnType<typeof createDb>;

beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
}, 60_000);

afterAll(async () => {
	await database?.pool.end();
	await container?.stop();
});

async function authorizedJob(): Promise<GitCafeConnectionJob> {
	const userId = generateId();
	const sessionId = generateId();
	const orgId = generateId();
	await database.db.insert(user).values({
		id: userId,
		name: "Connection test",
		email: `${userId}@example.test`,
		accessStatus: "approved",
	});
	await database.db.insert(session).values({
		id: sessionId,
		userId,
		token: generateId(),
		expiresAt: new Date(Date.now() + 3600_000),
	});
	await database.db.insert(organization).values({
		id: orgId,
		name: "Connection test",
		slug: `connection-${orgId}`,
	});
	await database.db
		.insert(member)
		.values({ id: generateId(), userId, organizationId: orgId, role: "admin" });
	const now = Date.now();
	return {
		userId,
		sessionId,
		orgId,
		installationId: `ins_${generateId()}`,
		subject: "connection-test-person",
		actorId: "connection-test-person",
		authorizedAt: now,
		expiresAt: now + 300_000,
		requestId: generateId(),
	};
}

test("a complete empty installation retires its previous repositories and preserves unrelated ones", async () => {
	const job = await authorizedJob();
	const previous = generateId();
	const unrelated = generateId();
	for (const [id, installationId] of [
		[previous, job.installationId],
		[unrelated, `ins_${generateId()}`],
	] as const)
		await database.db.insert(repos).values({
			id,
			forge: "gitcafe",
			externalId: id,
			owner: "fixture",
			name: id,
			fullName: `fixture/${id}`,
			orgId: job.orgId,
			installationId,
			armed: false,
		});
	expect(
		await commitGitCafeConnection(database.db, {
			job,
			owner: "fixture",
			repositories: [],
			revalidate: async () => ({ ok: true, repoCount: 0 }),
		}),
	).toEqual({ ok: true, repoCount: 0 });
	const oldRows = await database.db
		.select()
		.from(repos)
		.where(eq(repos.id, previous));
	const otherRows = await database.db
		.select()
		.from(repos)
		.where(eq(repos.id, unrelated));
	expect(oldRows[0]?.removedAt).toBeInstanceOf(Date);
	expect(oldRows[0]?.armed).toBe(false);
	expect(otherRows[0]?.removedAt).toBeNull();
});

test("failed revalidation of an empty discovery preserves all previous repositories", async () => {
	const job = await authorizedJob();
	const id = generateId();
	await database.db.insert(repos).values({
		id,
		forge: "gitcafe",
		externalId: id,
		owner: "fixture",
		name: id,
		fullName: `fixture/${id}`,
		orgId: job.orgId,
		installationId: job.installationId,
		armed: false,
	});
	expect(
		await commitGitCafeConnection(database.db, {
			job,
			owner: "fixture",
			repositories: [],
			revalidate: async () => ({ ok: false, reason: "authority-unavailable" }),
		}),
	).toEqual({ ok: false, reason: "authority-unavailable" });
	const [row] = await database.db.select().from(repos).where(eq(repos.id, id));
	expect(row?.removedAt).toBeNull();
});

test("an installation spans SQL batches and reconnect preserves stable row identities", async () => {
	const job = await authorizedJob();
	const selected = Array.from(
		{ length: 1001 },
		(_, index): GitCafeConnectionRepository => ({
			id: generateId(),
			owner: "fixture",
			name: `repo-${index}`,
			visibility: "private",
			archivedAt: null,
		}),
	);
	expect(
		await commitGitCafeConnection(database.db, {
			job,
			owner: "fixture",
			repositories: selected,
			revalidate: async () => ({ ok: true, repoCount: selected.length }),
		}),
	).toEqual({ ok: true, repoCount: 1001 });
	const before = await database.db
		.select()
		.from(repos)
		.where(eq(repos.installationId, job.installationId));
	expect(before).toHaveLength(1001);
	const kept = selected
		.filter((_, index) => index === 0 || index === 500 || index === 1000)
		.map(
			(repo): GitCafeConnectionRepository => ({
				...repo,
				name: `renamed-${repo.name}`,
				visibility: "public",
			}),
		);
	expect(
		await commitGitCafeConnection(database.db, {
			job,
			owner: "fixture",
			repositories: kept,
			revalidate: async () => ({ ok: true, repoCount: kept.length }),
		}),
	).toEqual({ ok: true, repoCount: 3 });
	const after = await database.db
		.select()
		.from(repos)
		.where(eq(repos.installationId, job.installationId));
	const retained = after.filter((row) => row.removedAt === null);
	expect(retained).toHaveLength(3);
	for (const row of retained) {
		const old = before.find((old) => old.externalId === row.externalId);
		if (!old) throw new Error("Retained repository lost its original identity");
		expect(row.id).toBe(old.id);
		expect(row.name).toStartWith("renamed-");
		expect(row.private).toBe(false);
		expect(row.armed).toBe(false);
	}
	expect(after.filter((row) => row.removedAt !== null)).toHaveLength(998);
});

test("large discovery checks collisions without exceeding PostgreSQL's parameter limit", async () => {
	const job = await authorizedJob();
	await database.db.insert(repos).values({
		id: generateId(),
		forge: "github",
		externalId: generateId(),
		owner: "other-forge",
		name: "repo-0",
		fullName: "other-forge/repo-0",
		orgId: job.orgId,
	});
	const selected = Array.from(
		{ length: 33000 },
		(_, index): GitCafeConnectionRepository => ({
			id: generateId(),
			owner: "large-fixture",
			name: `repo-${index}`,
			visibility: "private",
			archivedAt: null,
		}),
	);
	expect(
		await commitGitCafeConnection(database.db, {
			job,
			owner: "large-fixture",
			repositories: selected,
			revalidate: async () => ({ ok: true, repoCount: selected.length }),
		}),
	).toEqual({ ok: false, reason: "repository-conflict" });
	const written = await database.db
		.select()
		.from(repos)
		.where(eq(repos.installationId, job.installationId));
	expect(written).toHaveLength(0);
}, 15_000);

test("the lifecycle connection path fails closed without checked authority or a generation", async () => {
	const job = await authorizedJob();
	for (const expectedGeneration of [undefined, 1]) {
		expect(
			await commitGitCafeConnection(database.db, {
				job,
				owner: "fixture",
				repositories: [],
				lifecycleEnabled: true,
				expectedGeneration,
				revalidate: async () => ({ ok: true, repoCount: 0 }),
			}),
		).toEqual({ ok: false, reason: "installation-mismatch" });
	}
	expect(
		await database.db
			.select()
			.from(repos)
			.where(eq(repos.installationId, job.installationId)),
	).toHaveLength(0);
});
