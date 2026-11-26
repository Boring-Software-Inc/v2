import { afterAll, beforeAll, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { runs } from "../schema/runs.ts";
import { pruneEvents } from "./events.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

async function seedEvent(
	id: string,
	age: number,
	extra: Partial<typeof events.$inferInsert> = {},
) {
	await db.insert(events).values({
		id,
		deliveryId: id,
		rawKind: "pull_request",
		raw: {},
		receivedAt: daysAgo(age),
		...extra,
	});
}

async function remaining(ids: string[]): Promise<string[]> {
	const rows = await db
		.select({ id: events.id })
		.from(events)
		.where(inArray(events.id, ids));
	return rows.map((row) => row.id).sort();
}

test("old GitHub events nothing reads are deleted; the rest are kept", async () => {
	await seedEvent("old-1", 40);
	await seedEvent("old-2", 41);
	await seedEvent("old-3", 42);
	await seedEvent("recent", 10);
	await seedEvent("with-run", 40);
	await db.insert(runs).values({
		id: "run-1",
		eventId: "with-run",
		repoFullName: "acme/app",
		workflowSnapshot: [],
	});
	await seedEvent("installation", 400, { rawKind: "installation" });
	await seedEvent("quarantined", 40, { quarantined: true });
	await seedEvent("gitcafe", 40, { forge: "gitcafe" });

	// Batches of 2 still clear all three deletable events.
	expect(await pruneEvents(db, { olderThanDays: 30, batchSize: 2 })).toBe(3);
	expect(
		await remaining([
			"old-1",
			"old-2",
			"old-3",
			"recent",
			"with-run",
			"installation",
			"quarantined",
			"gitcafe",
		]),
	).toEqual(["gitcafe", "installation", "quarantined", "recent", "with-run"]);
});

test("a window under 30 days is raised to 30, since backfill reads that far", async () => {
	await seedEvent("twenty-days", 20);
	expect(await pruneEvents(db, { olderThanDays: 1 })).toBe(0);
	expect(await remaining(["twenty-days"])).toEqual(["twenty-days"]);
});
