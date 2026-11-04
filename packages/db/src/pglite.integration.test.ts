import {
	afterAll,
	beforeAll,
	describe,
	expect,
	expectTypeOf,
	test,
} from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import { backfillOrgs } from "./backfill-orgs.ts";
import { createDb, type Db, requirePostgresPool } from "./client.ts";
import { applyMigrations } from "./migrate.ts";
import {
	applyPgliteMigrations,
	createPgliteDb,
	type PgliteHandle,
} from "./pglite.ts";
import { user } from "./schema/auth.ts";
import {
	organization,
	organizationInstallations,
} from "./schema/organizations.ts";
import { repos } from "./schema/repos.ts";
import { ensureDemoRepo, seedStory } from "./seed.ts";
import { pendingUserRow, promoteUserAccess } from "./services/access.ts";
import * as insightServices from "./services/insights.ts";
import * as moderationServices from "./services/moderation.ts";
import { ensureRepo } from "./services/repos.ts";
import { createTestDatabase } from "./testing.ts";

/**
 * `dev:demo` runs the app on embedded PGlite. This proves the SAME generated
 * migrations and the SAME service layer run on PGlite with no drift (dialect
 * parity — the reason SQLite was rejected, see DECISIONS.md). In-memory, no
 * Docker, no data dir.
 */
let handle: PgliteHandle;
let db: Db;

beforeAll(async () => {
	handle = createPgliteDb();
	db = handle.db;
	await applyPgliteMigrations(handle.client);
}, 60_000);

afterAll(async () => {
	await handle?.client.close();
});

test("prod migrations + services run on PGlite; the seeded story is coherent", async () => {
	const repo = await ensureDemoRepo(db, "active-webapp", {
		installationId: "demo-inst-active",
	});
	await seedStory(db, repo, new Date());

	const stats = await insightServices.getHomeStats(db, {
		forge: "github",
		fullName: repo.fullName,
	});
	// The queue series' last point IS the number (the §13.10 invariant), on PGlite too.
	expect(stats.sentToReview.series[23]).toBe(stats.sentToReview.value);
	expect(stats.blocked.series).toHaveLength(24);

	const pending = await moderationServices.listPendingItems(db, [
		{ forge: "github", fullName: repo.fullName },
	]);
	expect(pending.length).toBe(stats.sentToReview.value);
	expect(pending.length).toBeGreaterThan(0);
	const item = pending[0];
	if (!item) {
		throw new Error("expected a pending moderation item");
	}

	// The worker-free decision path (dev:demo) resolves the item.
	const decided = await moderationServices.markModerationDecided(db, {
		itemId: item.id,
		decision: "approve",
		decidedBy: null,
	});
	expect(decided).toBe(true);
	const after = await moderationServices.listPendingItems(db, [
		{ forge: "github", fullName: repo.fullName },
	]);
	expect(after.length).toBe(pending.length - 1);
	// seedStory + the insight aggregations run ~5s on in-memory PGlite and
	// flake past bun's 5s default under load; give it the same headroom the
	// migration beforeAll gets.
}, 30_000);

describe.each(["postgres", "pglite"])("shared Db on %s", (driver) => {
	let shared: Db;
	let close: () => Promise<void>;

	beforeAll(async () => {
		if (driver === "postgres") {
			const container = await createTestDatabase();
			const database = createDb(container.url);
			shared = database.db;
			close = async () => {
				await database.pool.end();
				await container.stop();
			};
			await applyMigrations(shared);
		} else {
			const database = createPgliteDb();
			shared = database.db;
			close = () => database.client.close();
			await applyPgliteMigrations(database.client);
		}
	}, 120_000);

	afterAll(async () => {
		await close?.();
	});

	test("retains selected, relational, returning and transaction row types", async () => {
		const pending = pendingUserRow({
			name: "Shared driver",
			email: `${generateId()}@example.test`,
		});
		const inserted = await shared.insert(user).values(pending).returning();
		expectTypeOf(inserted).toEqualTypeOf<(typeof user.$inferSelect)[]>();
		expect(inserted[0]?.accessStatus).toBe("pending");
		const selected = await shared
			.select({ id: user.id, reviewedAt: user.accessReviewedAt })
			.from(user)
			.where(eq(user.id, pending.id));
		expectTypeOf(selected).toEqualTypeOf<
			{ id: string; reviewedAt: Date | null }[]
		>();
		expect(selected).toEqual([{ id: pending.id, reviewedAt: null }]);
		const relational = await shared.query.user.findFirst({
			where: eq(user.id, pending.id),
		});
		expectTypeOf(relational).toEqualTypeOf<
			typeof user.$inferSelect | undefined
		>();
		expect(relational?.email).toBe(pending.email);

		const committed = await shared.transaction(async (tx) => {
			const promoted = await promoteUserAccess(tx, {
				userId: pending.id,
				reviewedBy: pending.id,
			});
			expect(promoted).toEqual({ promoted: true });
			const rows = await tx
				.select({
					status: user.accessStatus,
					reviewedAt: user.accessReviewedAt,
				})
				.from(user)
				.where(eq(user.id, pending.id));
			expectTypeOf(rows).toEqualTypeOf<
				{
					status: typeof user.$inferSelect.accessStatus;
					reviewedAt: Date | null;
				}[]
			>();
			return rows;
		});
		expect(committed[0]?.status).toBe("approved");
		expect(committed[0]?.reviewedAt).toBeInstanceOf(Date);
		await expect(
			shared.transaction(async (tx) => {
				await tx
					.update(user)
					.set({ name: "Rolled back" })
					.where(eq(user.id, pending.id));
				await tx.transaction(async (nested) => {
					await nested
						.update(user)
						.set({ name: "Nested" })
						.where(eq(user.id, pending.id));
				});
				tx.rollback();
			}),
		).rejects.toThrow();
		const [after] = await shared
			.select()
			.from(user)
			.where(eq(user.id, pending.id));
		expect(after?.name).toBe(pending.name);
	});

	test("backfill counts affected rows, corrects stale ownership and is idempotent", async () => {
		const orgId = generateId();
		const staleOrgId = generateId();
		const installationId = generateId();
		await shared.insert(organization).values([
			{ id: orgId, name: "Claimed", slug: orgId },
			{ id: staleOrgId, name: "Stale", slug: staleOrgId },
		]);
		await shared.insert(organizationInstallations).values({
			id: generateId(),
			organizationId: orgId,
			installationId,
			forge: "github",
		});
		const repoIds: string[] = [];
		for (const org of [null, staleOrgId, orgId]) {
			const name = generateId();
			repoIds.push(
				await ensureRepo(shared, {
					externalId: name,
					owner: "driver",
					name,
					fullName: `driver/${name}`,
					installationId,
					orgId: org,
				}),
			);
		}
		const otherId = generateId();
		await ensureRepo(shared, {
			forge: "opengit",
			externalId: otherId,
			owner: "driver",
			name: otherId,
			fullName: `driver/${otherId}`,
			installationId,
		});
		const first = await backfillOrgs(shared);
		expect(first.reposLinked).toBe(2);
		expect(first.claimedButNullRepos).toBe(0);
		expect(first.unclaimedRepos).toBe(1);
		for (const id of repoIds) {
			const [row] = await shared.select().from(repos).where(eq(repos.id, id));
			expect(row?.orgId).toBe(orgId);
		}
		const second = await backfillOrgs(shared);
		expect(second).toEqual({ ...first, reposLinked: 0 });
	});

	test("PostgreSQL pool capability is explicit; migrations remain repeatable", async () => {
		if (driver === "postgres") {
			expect(requirePostgresPool(shared) === shared.$client).toBe(true);
			const before = await shared.execute<{ n: number }>(
				sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
			);
			await applyMigrations(shared);
			const after = await shared.execute<{ n: number }>(
				sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
			);
			expect(after.rows).toEqual(before.rows);
			expect(after.rows[0]?.n).toBeGreaterThan(0);
		} else {
			expect(() => requirePostgresPool(shared)).toThrow(
				"requires a PostgreSQL connection pool",
			);
			await expect(applyMigrations(shared)).rejects.toThrow(
				"requires a PostgreSQL connection pool",
			);
			const before = await shared.select().from(repos);
			if (!(shared.$client instanceof PGlite))
				throw new Error("Expected PGlite");
			await applyPgliteMigrations(shared.$client);
			expect(await shared.select().from(repos)).toEqual(before);
		}
	});
});
