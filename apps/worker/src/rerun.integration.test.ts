import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	RERUN_COOLDOWN_SECONDS,
	RERUN_QUEUE,
	repoServices,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { processEvent } from "./jobs/process-event.ts";
import { rerunChangeRequest } from "./jobs/rerun.ts";

/**
 * §11 integration — manual re-run on REAL postgres, forge mocked at the
 * adapter boundary (layer 4). The motivating scenario end to end: a PR passes
 * under lenient rules, the maintainer tightens them, re-run blocks it as a
 * NEW run and delivers the amendment; the original run is never touched.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });

const exemptionBefore = process.env.TRIPWIRE_DISABLE_EXEMPTION;

const ORIGINAL_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";
const MOVED_SHA = "aaaa1111bbbb2222cccc3333dddd4444eeee5555";

/** A two-year-old, reputable contributor — passes the default rules. */
const trustedProfile = {
	login: "sockpuppet",
	externalId: "999",
	createdAt: new Date(Date.now() - 730 * 86_400_000).toISOString(),
	followers: 50,
	following: 10,
	publicRepos: 12,
	profileText: "long-time contributor",
	mergedInRepo: 5,
	mergedElsewhere: 20,
	recentChangeRequestTimes: [],
	isOrgMember: false,
	isMaintainer: false,
};

function makeReads(headSha: string) {
	return {
		getDiff: () =>
			Promise.resolve([
				{
					path: "src/app.ts",
					status: "modified" as const,
					additions: 3,
					deletions: 1,
				},
			]),
		getCommits: () =>
			Promise.resolve([
				{
					sha: headSha,
					message: "fix",
					authorLogin: "sockpuppet",
					authorEmail: null,
					authoredAt: new Date().toISOString(),
				},
			]),
		getContributorProfile: () => Promise.resolve(trustedProfile),
	};
}

const passGenerate = () => () =>
	Promise.resolve({
		output: {
			verdict: "pass" as const,
			confidence: 0.9,
			summary: "clean.",
			findings: [],
		},
		trace: {},
	});

function fakeAdapter(options: { failCheck?: boolean } = {}) {
	const executed: {
		kind: string;
		sha?: string;
		body?: string;
	}[] = [];
	return {
		executed,
		adapter: {
			execute: (action: {
				kind: string;
				check?: { sha: string };
				body?: string;
			}) => {
				if (options.failCheck && action.kind === "set-check") {
					return Promise.reject(new Error("github refused the check"));
				}
				executed.push({
					kind: action.kind,
					sha: action.check?.sha,
					body: action.body,
				});
				return Promise.resolve({ externalId: `ext-${executed.length}` });
			},
		} as never,
	};
}

function baseDeps(
	adapter: never,
	headSha: string,
): Parameters<typeof processEvent>[0] {
	return {
		db,
		pool,
		logger,
		adapter,
		makeGenerate: passGenerate as never,
		appUrl: "https://tripwire.sh",
		reads: makeReads(headSha),
	};
}

async function fixtureRaw(): Promise<unknown> {
	const path = new URL(
		"../../../packages/forge-github/fixtures/pull_request.opened.json",
		import.meta.url,
	).pathname;
	return await Bun.file(path).json();
}

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

describe("manual re-run (§ re-run feature)", () => {
	let originalRun: {
		id: string;
		verdict: string;
		status: string;
		completed_at: Date;
		head_sha: string;
	};

	test("setup: the PR passes under the current (lenient) rules", async () => {
		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "rerun-base",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		const fake = fakeAdapter();
		await processEvent(baseDeps(fake.adapter, ORIGINAL_SHA), { eventId });
		const runs = await pool.query(
			"SELECT id, verdict, status, completed_at, head_sha, triggered_by FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(runs.rowCount).toBe(1);
		expect(runs.rows[0].verdict).toBe("pass");
		expect(runs.rows[0].triggered_by).toBeNull();
		originalRun = runs.rows[0];
		const passComment = fake.executed.find((e) => e.kind === "comment");
		expect(passComment?.body).toContain("**passed**");
	});

	test("re-run under tightened rules ⇒ NEW blocked run, original untouched, amendment delivered", async () => {
		// The maintainer "fixes their workflow": tighten account-age far past
		// the contributor's 730 days. The re-run resolves CURRENT configs.
		const repo = await repoServices.getRepoByFullName(
			db,
			"Codertocat/Hello-World",
		);
		if (!repo) {
			throw new Error("repo missing");
		}
		await repoServices.upsertRuleConfig(db, repo.id, {
			ruleId: "account-age",
			version: 1,
			enabled: true,
			config: { minDays: 10_000 },
		});

		const fake = fakeAdapter();
		await rerunChangeRequest(baseDeps(fake.adapter, MOVED_SHA), {
			repoFullName: "Codertocat/Hello-World",
			number: 2,
			requestedBy: "admin-1",
		});

		const runs = await pool.query(
			"SELECT id, verdict, status, head_sha, triggered_by FROM runs WHERE repo_full_name = 'Codertocat/Hello-World' AND subject_number = 2 ORDER BY id",
		);
		expect(runs.rowCount).toBe(2);
		const rerunRow = runs.rows[1];
		expect(rerunRow.verdict).toBe("block");
		expect(rerunRow.triggered_by).toBe("admin-1");
		// Moved head: the new run and its check target the FRESH sha, not the
		// stored event's — a check on a non-head commit is invisible on the PR.
		expect(rerunRow.head_sha).toBe(MOVED_SHA);
		const checks = fake.executed.filter(
			(e) => e.kind === "set-check" && e.sha === MOVED_SHA,
		);
		expect(checks.length).toBeGreaterThan(0);
		expect(
			fake.executed.some(
				(e) => e.kind === "set-check" && e.sha === originalRun.head_sha,
			),
		).toBe(false);

		// Original run byte-identical on the fields that matter.
		const original = await pool.query(
			"SELECT verdict, status, completed_at FROM runs WHERE id = $1",
			[originalRun.id],
		);
		expect(original.rows[0].verdict).toBe(originalRun.verdict);
		expect(original.rows[0].status).toBe(originalRun.status);
		expect(original.rows[0].completed_at.getTime()).toBe(
			originalRun.completed_at.getTime(),
		);

		// The amendment: a blocked comment carrying the re-evaluation note. The
		// pass→block transition + supersession mechanics live in upsertComment
		// (covered by actions.test.ts) — here we assert the rendered body.
		const comment = fake.executed.find((e) => e.kind === "comment");
		expect(comment?.body).toContain("**blocked**");
		expect(comment?.body).toContain(
			"re-evaluated under the repo's current rules.",
		);
	});

	test("check delivery failure is recorded, never fatal — the run completes", async () => {
		const fake = fakeAdapter({ failCheck: true });
		await rerunChangeRequest(baseDeps(fake.adapter, MOVED_SHA), {
			repoFullName: "Codertocat/Hello-World",
			number: 2,
			requestedBy: "admin-1",
		});
		const runs = await pool.query(
			"SELECT id, status FROM runs WHERE repo_full_name = 'Codertocat/Hello-World' AND subject_number = 2 ORDER BY id",
		);
		expect(runs.rowCount).toBe(3);
		const latest = runs.rows[2];
		// The run itself completed despite the forge refusing the check.
		expect(latest.status).toBe("completed");
		// The check row stays `recorded` — the sweeper's retry surface, and the
		// run page's honest delivery record.
		const actions = await pool.query(
			"SELECT kind, status FROM run_actions WHERE run_id = $1 AND kind = 'set-check'",
			[latest.id],
		);
		expect(actions.rows[0].status).toBe("recorded");
	});

	test("re-run for a PR with no evaluatable event is a logged no-op", async () => {
		const before = await pool.query("SELECT count(*)::int AS n FROM runs");
		await rerunChangeRequest(baseDeps(fakeAdapter().adapter, MOVED_SHA), {
			repoFullName: "Codertocat/Hello-World",
			number: 9999,
			requestedBy: "admin-1",
		});
		const after = await pool.query("SELECT count(*)::int AS n FROM runs");
		expect(after.rows[0].n).toBe(before.rows[0].n);
	});

	test("dedup + cooldown: singletonKey rejects a second enqueue in the window", async () => {
		const data = {
			repoFullName: "Codertocat/Hello-World",
			number: 2,
			requestedBy: "admin-1",
		};
		const options = {
			singletonKey: "Codertocat/Hello-World#2",
			singletonSeconds: RERUN_COOLDOWN_SECONDS,
		};
		const first = await boss.send(RERUN_QUEUE, data, options);
		expect(first).not.toBeNull();
		const second = await boss.send(RERUN_QUEUE, data, options);
		expect(second).toBeNull();
	});
});
