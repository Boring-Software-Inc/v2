import { afterAll, beforeAll, expect, test } from "bun:test";
import type { GitCafeConnectionJob } from "@tripwire/contracts";
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
