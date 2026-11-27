import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	repoServices,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { normalizeFor, staticForge } from "./forge-runtime.ts";
import { type ProcessEventDeps, processEvent } from "./jobs/process-event.ts";

/**
 * An attempt can fail after it normalized the event (a GitHub 5xx while
 * building context, a DB blip). pg-boss retries the job, and the retry used to
 * return early because the event was already normalized, so the PR never got a
 * check. The retry must finish the work, and never run it twice.
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
	// The pull_request.opened fixture is scoped to Codertocat/Hello-World.
	const repoId = await repoServices.ensureRepo(db, {
		externalId: "35129377",
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

test("a retry after normalization runs the workflow once", async () => {
	const raw: unknown = await Bun.file(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.opened.json",
			import.meta.url,
		).pathname,
	).json();
	const deliveryId = "retry-after-normalize";
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId,
		rawKind: "pull_request",
		raw,
	});
	const normalized = normalizeFor("github")?.(
		{
			deliveryId,
			eventName: "pull_request",
			body: JSON.stringify(raw),
			signature: null,
		},
		new Date().toISOString(),
	);
	if (!eventId || !normalized) throw new Error("fixture did not normalize");
	// The failed first attempt got this far.
	await eventServices.markEventNormalized(db, pool, eventId, normalized);

	const deps: ProcessEventDeps = {
		resumeNormalized: true,
		db,
		pool,
		logger: pino({ level: "silent" }),
		resolveForge: staticForge({ reads }),
		makeGenerate: null,
		appUrl: "http://localhost:3000",
	};
	await processEvent(deps, { eventId });
	await processEvent(deps, { eventId });

	const runs = await pool.query("SELECT id FROM runs WHERE event_id = $1", [
		eventId,
	]);
	expect(runs.rowCount).toBe(1);
});
