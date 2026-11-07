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
	createDb,
	createTestDatabase,
	type Db,
	installationAccessServices,
	type TestDatabase,
} from "../index.ts";
import { installationAccessChecks, user } from "../schema/index.ts";

let container: TestDatabase;
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
	await seedUser("rate-user-a");
	await seedUser("rate-user-b");
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

beforeEach(async () => {
	await db.delete(installationAccessChecks);
});

describe("countRecentInstallAccessChecks", () => {
	test("zero for a user with no rows", async () => {
		expect(
			await installationAccessServices.countRecentInstallAccessChecks(
				db,
				"rate-user-a",
				60,
			),
		).toBe(0);
	});

	test("counts distinct installation ids within the window", async () => {
		for (const id of ["100", "101", "102"]) {
			await installationAccessServices.recordInstallAccessCheck(db, {
				userId: "rate-user-a",
				forge: "github",
				installationId: id,
				result: "pending",
			});
		}
		expect(
			await installationAccessServices.countRecentInstallAccessChecks(
				db,
				"rate-user-a",
				60,
			),
		).toBe(3);
	});

	test("repeating the same id does not increase the count (upsert)", async () => {
		for (let i = 0; i < 5; i++) {
			await installationAccessServices.recordInstallAccessCheck(db, {
				userId: "rate-user-a",
				forge: "github",
				installationId: "200",
				result: "pending",
			});
		}
		expect(
			await installationAccessServices.countRecentInstallAccessChecks(
				db,
				"rate-user-a",
				60,
			),
		).toBe(1);
	});

	test("rows outside the window are not counted", async () => {
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-a",
			forge: "github",
			installationId: "300",
			result: "pending",
		});
		await ageRow("300", 120);
		expect(
			await installationAccessServices.countRecentInstallAccessChecks(
				db,
				"rate-user-a",
				60,
			),
		).toBe(0);
	});

	test("counts are per-user, not global", async () => {
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-a",
			forge: "github",
			installationId: "400",
			result: "pending",
		});
		await installationAccessServices.recordInstallAccessCheck(db, {
			userId: "rate-user-b",
			forge: "github",
			installationId: "401",
			result: "pending",
		});
		expect(
			await installationAccessServices.countRecentInstallAccessChecks(
				db,
				"rate-user-a",
				60,
			),
		).toBe(1);
		expect(
			await installationAccessServices.countRecentInstallAccessChecks(
				db,
				"rate-user-b",
				60,
			),
		).toBe(1);
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
