import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { processEvent } from "./jobs/process-event.ts";

/**
 * §11 integration — the worker half of the §5 pipeline on REAL postgres:
 * raw event → normalize → normalized cols + jsonb written → NOTIFY 'events'
 * observed by a dedicated LISTEN connection. Malformed payload ⇒ quarantined,
 * raw untouched. Re-processing a normalized event is a no-op.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });

// Pin the exemption flag OFF so ambient env can't contaminate the maintainer
// exemption assertions (VERIFICATION-QUEUE #10 root cause).
const exemptionBefore = process.env.TRIPWIRE_DISABLE_EXEMPTION;

beforeAll(async () => {
	delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
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

async function fixtureRaw(): Promise<unknown> {
	const path = new URL(
		"../../../packages/forge-github/fixtures/pull_request.opened.json",
		import.meta.url,
	).pathname;
	return await Bun.file(path).json();
}

describe("processEvent", () => {
	test("normalizes, writes cols + jsonb, and NOTIFYs 'events'", async () => {
		const listener = await pool.connect();
		const notifications: string[] = [];
		listener.on("notification", (msg) => {
			if (msg.payload) {
				notifications.push(msg.payload);
			}
		});
		await listener.query("LISTEN events");

		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-d1",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: null,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId },
		);

		const row = await pool.query(
			"SELECT kind, repo_full_name, actor_login, subject_number, head_sha, normalized, quarantined FROM events WHERE id = $1",
			[eventId],
		);
		expect(row.rows[0].kind).toBe("change-request.opened");
		expect(row.rows[0].repo_full_name).toContain("/");
		expect(row.rows[0].subject_number).toBeGreaterThan(0);
		expect(row.rows[0].head_sha).toMatch(/^[0-9a-f]{40}$/);
		expect(row.rows[0].quarantined).toBe(false);
		expect(row.rows[0].normalized.kind).toBe("change-request.opened");

		const deadline = Date.now() + 5000;
		while (notifications.length === 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 50));
		}
		expect(notifications).toContain(eventId);

		await listener.query("UNLISTEN events");
		listener.release();
	});

	test("re-processing a normalized event is a no-op", async () => {
		const row = await pool.query(
			"SELECT id, normalized_at FROM events WHERE delivery_id = $1",
			["worker-d1"],
		);
		const before = row.rows[0].normalized_at;
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: null,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId: row.rows[0].id },
		);
		const after = await pool.query(
			"SELECT normalized_at FROM events WHERE id = $1",
			[row.rows[0].id],
		);
		expect(after.rows[0].normalized_at.getTime()).toBe(before.getTime());
	});

	test("malformed ingested payload ⇒ quarantined, raw untouched", async () => {
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-d2",
			rawKind: "pull_request",
			raw: { action: "opened", nonsense: true },
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: null,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId },
		);
		const row = await pool.query(
			"SELECT quarantined, quarantine_reason, raw, normalized FROM events WHERE id = $1",
			[eventId],
		);
		expect(row.rows[0].quarantined).toBe(true);
		expect(row.rows[0].quarantine_reason.length).toBeGreaterThan(0);
		expect(row.rows[0].raw).toEqual({ action: "opened", nonsense: true });
		expect(row.rows[0].normalized).toBeNull();
	});

	test("non-ingested kind (ping) stays un-normalized, not quarantined", async () => {
		const pingPath = new URL(
			"../../../packages/forge-github/fixtures/ping.json",
			import.meta.url,
		).pathname;
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-d3",
			rawKind: "ping",
			raw: await Bun.file(pingPath).json(),
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: null,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId },
		);
		const row = await pool.query(
			"SELECT normalized_at, quarantined FROM events WHERE id = $1",
			[eventId],
		);
		expect(row.rows[0].normalized_at).toBeNull();
		expect(row.rows[0].quarantined).toBe(false);
	});
});

describe("runWorkflows via processEvent (§13.6 done-when)", () => {
	const freshAccountReads = {
		getDiff: () =>
			Promise.resolve([
				{
					path: "src/app.ts",
					status: "modified" as const,
					additions: 3,
					deletions: 1,
				},
			]),
		getCommits: () => Promise.resolve([]),
		getContributorProfile: () =>
			Promise.resolve({
				login: "sockpuppet",
				externalId: "999",
				createdAt: new Date(
					Date.now() - 2 * 86_400_000 - 3_600_000,
				).toISOString(),
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

	test("fresh-account PR ⇒ run persisted with snapshot, steps, verdict block, action row", async () => {
		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-run-1",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: freshAccountReads,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId },
		);

		const runRows = await pool.query(
			"SELECT id, status, verdict, workflow_snapshot, head_sha, subject_number FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(runRows.rowCount).toBe(1);
		const run = runRows.rows[0];
		expect(run.status).toBe("completed");
		expect(run.verdict).toBe("block");
		expect(run.workflow_snapshot[0].id).toBe("default@1");
		expect(run.head_sha).toMatch(/^[0-9a-f]{40}$/);

		const steps = await pool.query(
			"SELECT node_id, node_kind, rule_id, status, evidence, duration_ms FROM run_steps WHERE run_id = $1 ORDER BY started_at",
			[run.id],
		);
		expect(steps.rowCount).toBeGreaterThanOrEqual(7);
		const ageStep = steps.rows.find((s) => s.rule_id === "account-age@1");
		expect(ageStep.status).toBe("fail");
		expect(ageStep.evidence.evidence.accountAgeDays).toBe(2);

		const actions = await pool.query(
			"SELECT kind, status, idempotency_key FROM run_actions WHERE run_id = $1 ORDER BY kind",
			[run.id],
		);
		expect(actions.rows.map((r) => [r.kind, r.status])).toEqual([
			["block", "recorded"],
			["comment", "recorded"],
			["set-check", "recorded"],
		]);
	});

	test("maintainer PR ⇒ exempt, no run", async () => {
		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-run-2",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
				reads: {
					...freshAccountReads,
					getContributorProfile: () =>
						freshAccountReads.getContributorProfile().then((p) => ({
							...p,
							isMaintainer: true,
						})),
				},
			},
			{ eventId },
		);
		const runRows = await pool.query(
			"SELECT count(*)::int AS n FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(runRows.rows[0].n).toBe(0);
	});

	test("degraded reads (all throw) ⇒ fail-closed floor: needs_review + moderation item, never pass", async () => {
		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-run-3",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		const failing = () => Promise.reject(new Error("github is down"));
		await processEvent(
			{
				db,
				pool,
				logger,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
				reads: {
					getDiff: failing,
					getCommits: failing,
					getContributorProfile: failing,
				},
			},
			{ eventId },
		);
		const runRows = await pool.query(
			"SELECT id, status, verdict FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(runRows.rows[0].verdict).toBe("needs_review");
		expect(runRows.rows[0].status).toBe("paused");

		const degradation = await pool.query(
			"SELECT output FROM run_steps WHERE run_id = $1 AND node_id = 'run:degradation'",
			[runRows.rows[0].id],
		);
		expect(degradation.rowCount).toBe(1);
		expect(degradation.rows[0].output.degradedReads).toEqual([
			"diff",
			"commits",
			"contributor",
		]);

		const items = await pool.query(
			"SELECT node_id FROM moderation_items WHERE run_id = $1",
			[runRows.rows[0].id],
		);
		expect(items.rows[0].node_id).toBe("run:degraded");
	});

	test("partial degradation (minority skipped) ⇒ still pass", async () => {
		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-run-4",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				adapter: null,
				makeGenerate: () => () =>
					Promise.resolve({
						output: {
							verdict: "pass",
							confidence: 0.9,
							summary: "clean.",
							findings: [],
						},
						trace: {},
					}),
				appUrl: "http://localhost:3000",
				reads: {
					getDiff: () =>
						Promise.resolve([
							{
								path: "src/app.ts",
								status: "modified" as const,
								additions: 1,
								deletions: 1,
							},
						]),
					getCommits: () => Promise.resolve([]),
					getContributorProfile: () =>
						Promise.reject(new Error("profile fetch failed")),
				},
			},
			{ eventId },
		);
		const runRows = await pool.query(
			"SELECT id, status, verdict FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(runRows.rows[0].verdict).toBe("pass");
		expect(runRows.rows[0].status).toBe("completed");
		const skipped = await pool.query(
			"SELECT count(*)::int AS n FROM run_steps WHERE run_id = $1 AND node_kind = 'rule' AND status = 'skipped'",
			[runRows.rows[0].id],
		);
		expect(skipped.rows[0].n).toBe(1);
	});
});

describe("PR surface (§5.12–13, §7)", () => {
	function fakeAdapter() {
		const executed: { kind: string; detail: string }[] = [];
		return {
			executed,
			adapter: {
				forge: "github" as const,
				verifyWebhook: () => true,
				normalizeWebhook: () => null,
				getDiff: () => Promise.resolve([]),
				getCommits: () => Promise.resolve([]),
				readFile: () => Promise.resolve(null),
				getContributorProfile: () => Promise.reject(new Error("unused")),
				execute: (action: {
					kind: string;
					check?: { sha: string; conclusion: string };
					body?: string;
				}) => {
					executed.push({
						kind: action.kind,
						detail:
							action.kind === "set-check"
								? `${action.check?.conclusion}:${action.check?.sha.slice(0, 7)}`
								: (action.body?.split("\n")[0] ?? ""),
					});
					return Promise.resolve({ externalId: `ext-${executed.length}` });
				},
			},
		};
	}

	test("blocked run ⇒ pending check, block+comment+check rows recorded AND executed; retry is a no-op", async () => {
		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "surface-1",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		const fake = fakeAdapter();
		const deps = {
			db,
			pool,
			logger,
			adapter: fake.adapter as never,
			makeGenerate: null,
			appUrl: "https://tripwire.sh",
			reads: {
				getDiff: () => Promise.resolve([]),
				getCommits: () => Promise.resolve([]),
				getContributorProfile: () =>
					Promise.resolve({
						login: "sockpuppet",
						externalId: "999",
						createdAt: new Date(Date.now() - 86_400_000).toISOString(),
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
			},
		};
		await processEvent(deps, { eventId });

		const pendingCheck = fake.executed.find((e) =>
			e.detail.startsWith("pending"),
		);
		expect(pendingCheck).toBeDefined();
		const finalCheck = fake.executed.find((e) =>
			e.detail.startsWith("failure"),
		);
		expect(finalCheck).toBeDefined();
		const comment = fake.executed.find((e) => e.kind === "comment");
		expect(comment?.detail).toContain("**blocked**");
		// The comment speaks reasons, never a rule count.
		expect(comment?.detail).not.toMatch(/\d+ of \d+ rules?/);

		const runRow = await pool.query("SELECT id FROM runs WHERE event_id = $1", [
			eventId,
		]);
		const actions = await pool.query(
			"SELECT kind, status, external_id FROM run_actions WHERE run_id = $1 ORDER BY kind",
			[runRow.rows[0].id],
		);
		expect(actions.rows.map((r) => [r.kind, r.status])).toEqual([
			["block", "executed"],
			["comment", "executed"],
			["set-check", "executed"],
		]);

		const executedBefore = fake.executed.length;
		const { emitPrSurface } = await import("./jobs/pr-surface.ts");
		await emitPrSurface(
			{
				db,
				adapter: fake.adapter as never,
				logger,
				appUrl: "https://tripwire.sh",
			},
			{
				runId: runRow.rows[0].id,
				verdict: "block",
				event: (await eventServices.getEventById(db, eventId))
					?.normalized as never,
				reasons: [{ text: "your account is 2 days old", remedy: "wait" }],
				pendingActionRows: [],
			},
		);
		expect(fake.executed.length).toBe(executedBefore);
	});
});

describe("installation sync (§4 installation sync — live gap fix)", () => {
	async function installationFixture(name: string): Promise<unknown> {
		return await Bun.file(
			new URL(
				`../../../packages/forge-github/fixtures/${name}.json`,
				import.meta.url,
			).pathname,
		).json();
	}

	test("install event ⇒ repo row with installation id (visible to /rules)", async () => {
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "install-1",
			rawKind: "installation",
			raw: await installationFixture("installation.created"),
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: null,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId },
		);
		const rows = await pool.query(
			"SELECT external_id, installation_id, removed_at FROM repos WHERE full_name = 'Boring-Software-Inc/scratch'",
		);
		expect(rows.rowCount).toBe(1);
		expect(rows.rows[0].external_id).toBe("1297742259");
		expect(rows.rows[0].installation_id).toBe("145946161");
		expect(rows.rows[0].removed_at).toBeNull();

		const { repoServices } = await import("@tripwire/db");
		const active = await repoServices.listActiveRepos(db);
		expect(
			active.some((r) => r.fullName === "Boring-Software-Inc/scratch"),
		).toBe(true);

		const runs = await pool.query(
			"SELECT count(*)::int AS n FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(runs.rows[0].n).toBe(0);
	});

	test("uninstall ⇒ soft delete (removed_at set), history intact", async () => {
		const raw = (await installationFixture("installation.created")) as {
			action: string;
		};
		const uninstall = { ...raw, action: "deleted" };
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "install-2",
			rawKind: "installation",
			raw: uninstall,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: null,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId },
		);
		const rows = await pool.query(
			"SELECT removed_at FROM repos WHERE full_name = 'Boring-Software-Inc/scratch'",
		);
		expect(rows.rows[0].removed_at).not.toBeNull();

		const { repoServices } = await import("@tripwire/db");
		const active = await repoServices.listActiveRepos(db);
		expect(
			active.some((r) => r.fullName === "Boring-Software-Inc/scratch"),
		).toBe(false);
	});

	test("change-request for an unknown repo lazily upserts the row", async () => {
		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "lazy-1",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				reads: null,
				adapter: null,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId },
		);
		const rows = await pool.query(
			"SELECT external_id FROM repos WHERE full_name = 'Codertocat/Hello-World' AND removed_at IS NULL",
		);
		expect(rows.rowCount).toBe(1);
		expect(rows.rows[0].external_id).toMatch(/^\d+$/);
	});
});
