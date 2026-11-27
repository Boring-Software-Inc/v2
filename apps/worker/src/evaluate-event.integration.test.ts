import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	GITHUB_EVALUATE_QUEUE,
	repoServices,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { normalizeFor, staticForge } from "./forge-runtime.ts";
import { evaluateEvent } from "./jobs/evaluate-event.ts";
import type { ProcessEventDeps } from "./jobs/process-event.ts";

/**
 * A PR pushed to twice while the queue was backed up gets one evaluation, of
 * its newest head: the older push finishes without a run.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;

const reads = {
	getDiff: () => Promise.resolve([]),
	getCommits: () => Promise.resolve([]),
	getContributorProfile: () =>
		Promise.resolve({
			login: "sockpuppet",
			externalId: "999",
			createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
			followers: 0,
			following: 0,
			publicRepos: 0,
			profileText: null,
			mergedInRepo: 0,
			mergedElsewhere: 0,
			recentChangeRequestTimes: [],
			isOrgMember: false,
			isMaintainer: false,
		}),
};

const exemptionBefore = process.env.TRIPWIRE_DISABLE_EXEMPTION;

beforeAll(async () => {
	delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	const repoId = await repoServices.ensureRepo(db, {
		externalId: "186853002",
		owner: "Codertocat",
		name: "Hello-World",
		fullName: "Codertocat/Hello-World",
	});
	await repoServices.setRepoArmed(db, repoId, true);
}, 120_000);

afterAll(async () => {
	if (exemptionBefore === undefined) {
		delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	} else {
		process.env.TRIPWIRE_DISABLE_EXEMPTION = exemptionBefore;
	}
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function ingestPush(deliveryId: string): Promise<string> {
	const body = await Bun.file(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.synchronize.json",
			import.meta.url,
		).pathname,
	).text();
	const normalized = normalizeFor("github")?.(
		{ deliveryId, eventName: "pull_request", body, signature: null },
		new Date().toISOString(),
	);
	const { eventId, lane } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId,
		rawKind: "pull_request",
		raw: JSON.parse(body),
		normalized,
	});
	if (!eventId) throw new Error("insert failed");
	expect(lane).toBe("evaluate");
	return eventId;
}

const runsFor = async (eventId: string) =>
	(await pool.query("SELECT id FROM runs WHERE event_id = $1", [eventId]))
		.rowCount;

test("an older push on the same PR finishes without a run", async () => {
	const older = await ingestPush("push-older");
	const newer = await ingestPush("push-newer");
	const jobs = await pool.query(
		"SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1",
		[GITHUB_EVALUATE_QUEUE],
	);
	expect(jobs.rows[0].n).toBe(2);

	const deps: ProcessEventDeps = {
		db,
		pool,
		logger: pino({ level: "silent" }),
		resolveForge: staticForge({ reads }),
		makeGenerate: null,
		appUrl: "http://localhost:3000",
	};
	await evaluateEvent(deps, { eventId: older });
	await evaluateEvent(deps, { eventId: newer });

	expect(await runsFor(older)).toBe(0);
	expect(await runsFor(newer)).toBe(1);
});
