import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	installationAccessServices,
	type TestDatabase,
} from "../index.ts";
import { installationAccessChecks, user } from "../schema/index.ts";

let container: TestDatabase;
let boss: Awaited<ReturnType<typeof createBoss>>;
let db: Db;
let pool: { end(): Promise<void> };

async function seedUser(id: string): Promise<void> {
	await db.insert(user).values({
		id,
		name: id,
		email: `${id}@example.com`,
	});
}

async function ageRow(
	installationId: string,
	secondsAgo: number,
): Promise<void> {
	await db
		.update(installationAccessChecks)
		.set({
			verifiedAt: sql`now() - make_interval(secs => ${secondsAgo})`,
		})
		.where(eq(installationAccessChecks.installationId, installationId));
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	await seedUser("rate-user-a");
	await seedUser("rate-user-b");
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false });
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

beforeEach(async () => {
	await db.delete(installationAccessChecks);
});

describe("requestInstallationRecovery", () => {
	test("caps concurrent requests across distinct IDs and preserves a separate user's budget", async () => {
		const requested = await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				installationAccessServices.requestInstallationRecovery(db, boss, {
					userId: "rate-user-a",
					installationId: String(100 + index),
				}),
			),
		);
		expect(requested.filter((result) => result === "queued")).toHaveLength(5);
		expect(
			requested.filter((result) => result === "rate-limited"),
		).toHaveLength(5);
		expect(await db.select().from(installationAccessChecks)).toHaveLength(5);
		await expect(
			installationAccessServices.requestInstallationRecovery(db, boss, {
				userId: "rate-user-b",
				installationId: "100",
			}),
		).resolves.toBe("queued");
	});

	test("coalesces repeated requests within the cooldown", async () => {
		const job = { userId: "rate-user-a", installationId: "200" };
		await expect(
			installationAccessServices.requestInstallationRecovery(db, boss, job),
		).resolves.toBe("queued");
		await expect(
			installationAccessServices.requestInstallationRecovery(db, boss, job),
		).resolves.toBe("already-requested");
	});

	test("leaves no pending access check when queue admission fails", async () => {
		const job = { userId: "rate-user-a", installationId: "300" };
		const unavailable = {
			send: () => Promise.reject(new Error("queue unavailable")),
		};
		await expect(
			installationAccessServices.requestInstallationRecovery(
				db,
				unavailable,
				job,
			),
		).rejects.toThrow("queue unavailable");
		expect(await db.select().from(installationAccessChecks)).toHaveLength(0);
		await expect(
			installationAccessServices.requestInstallationRecovery(db, boss, job),
		).resolves.toBe("queued");
	});
});

describe("pruneInstallAccessChecks", () => {
	test("deletes only rows older than the retention window", async () => {
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-a",
			forge: "github",
			installationId: "500",
			result: "pending",
		});
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-a",
			forge: "github",
			installationId: "501",
			result: "pending",
		});
		await ageRow("500", 8 * 24 * 60 * 60);
		const removed = await installationAccessServices.pruneInstallAccessChecks(
			db,
			7,
		);
		expect(removed).toBe(1);
		const remaining = await db
			.select({ installationId: installationAccessChecks.installationId })
			.from(installationAccessChecks);
		expect(remaining.map((r) => r.installationId)).toEqual(["501"]);
	});

	test("zero rows deleted when everything is fresh", async () => {
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-a",
			forge: "github",
			installationId: "600",
			result: "pending",
		});
		const removed = await installationAccessServices.pruneInstallAccessChecks(
			db,
			7,
		);
		expect(removed).toBe(0);
	});

	test("zero rows when the table is empty", async () => {
		const removed = await installationAccessServices.pruneInstallAccessChecks(
			db,
			7,
		);
		expect(removed).toBe(0);
	});

	test("deletes across all users", async () => {
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-a",
			forge: "github",
			installationId: "700",
			result: "pending",
		});
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-b",
			forge: "github",
			installationId: "701",
			result: "pending",
		});
		await ageRow("700", 10 * 24 * 60 * 60);
		await ageRow("701", 10 * 24 * 60 * 60);
		const removed = await installationAccessServices.pruneInstallAccessChecks(
			db,
			7,
		);
		expect(removed).toBe(2);
		expect(
			await db
				.select({ id: installationAccessChecks.id })
				.from(installationAccessChecks),
		).toEqual([]);
	});
});
