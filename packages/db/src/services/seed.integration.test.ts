import { afterAll, beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import {
	ensureDemoRepo,
	resetDemoData,
	seedPublicRun,
	seedStory,
} from "../seed.ts";
import * as insightServices from "./insights.ts";
import * as moderationServices from "./moderation.ts";

async function runCount(db: Db, fullName: string): Promise<number> {
	const rows = (
		await db.execute(
			sql`SELECT count(*)::int AS n FROM runs WHERE repo_full_name = ${fullName}`,
		)
	).rows as { n: number }[];
	return Number(rows[0]?.n ?? 0);
}

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

test("seedStory + seedPublicRun produce contract-valid, renderable data", async () => {
	await resetDemoData(db);
	const repo = await ensureDemoRepo(db, "webapp");
	const now = new Date();
	await seedStory(db, repo, now);
	const pub = await ensureDemoRepo(db, "public-oss", { private: false });
	const runId = await seedPublicRun(db, pub, now);
	expect(runId).toBeTruthy();

	// A year-old active repo — a LOT of runs, not a handful.
	expect(await runCount(db, repo.fullName)).toBeGreaterThan(800);

	const stats = await insightServices.getHomeStats(db, {
		forge: "github",
		fullName: repo.fullName,
	});
	// The queue card's last series point IS the number (the §13.10 invariant).
	expect(stats.sentToReview.series[23]).toBe(stats.sentToReview.value);
	expect(stats.blocked.series).toHaveLength(24);
	expect(stats.passed.series).toHaveLength(24);
	// A dense recent window means recent activity exists.
	expect(stats.blocked.value + stats.passed.value).toBeGreaterThan(0);

	const pending = await moderationServices.listPendingItems(db, [
		{ forge: "github", fullName: repo.fullName },
	]);
	expect(pending.length).toBe(stats.sentToReview.value);
	expect(pending.length).toBeGreaterThan(0);
	expect(pending.every((item) => item.title && item.actorLogin)).toBe(true);

	// Idempotent: seedStory skips an already-populated repo (no dup-key crash).
	const before = await runCount(db, repo.fullName);
	await seedStory(db, repo, now);
	expect(await runCount(db, repo.fullName)).toBe(before);
});
