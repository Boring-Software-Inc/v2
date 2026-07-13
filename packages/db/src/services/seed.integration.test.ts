import { afterAll, beforeAll, expect, test } from "bun:test";
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

	const stats = await insightServices.getHomeStats(db, repo.fullName);
	expect(stats.sentToReview.value).toBe(1); // one pending review
	expect(stats.blocked.value).toBeGreaterThanOrEqual(3);
	expect(stats.passed.value).toBeGreaterThanOrEqual(3);
	expect(stats.sentToReview.series[23]).toBe(stats.sentToReview.value);

	const pending = await moderationServices.listPendingItems(db, repo.fullName);
	expect(pending.length).toBe(1);

	// idempotent: reset + reseed yields the same counts, no dup-key crash.
	await resetDemoData(db);
	await seedStory(db, await ensureDemoRepo(db, "webapp"), now);
	const again = await insightServices.getHomeStats(db, repo.fullName);
	expect(again.blocked.value).toBe(stats.blocked.value);
});
