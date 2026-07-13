import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Db } from "./client.ts";
import {
	applyPgliteMigrations,
	createPgliteDb,
	type PgliteHandle,
} from "./pglite.ts";
import { ensureDemoRepo, seedStory } from "./seed.ts";
import * as insightServices from "./services/insights.ts";
import * as moderationServices from "./services/moderation.ts";

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

	const stats = await insightServices.getHomeStats(db, repo.fullName);
	expect(stats.blocked.value).toBeGreaterThanOrEqual(3);
	expect(stats.passed.value).toBeGreaterThanOrEqual(3);
	expect(stats.sentToReview.value).toBe(1);
	// The queue series' last point IS the number (the §13.10 invariant), on PGlite too.
	expect(stats.sentToReview.series[23]).toBe(stats.sentToReview.value);

	const pending = await moderationServices.listPendingItems(db, repo.fullName);
	expect(pending.length).toBe(1);
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
	const after = await moderationServices.listPendingItems(db, repo.fullName);
	expect(after.length).toBe(0);
});
