import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type RepoIdentity } from "@tripwire/contracts";
import { eq, sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { rollupsDaily } from "../schema/rollups.ts";
import * as insightServices from "./insights.ts";
import { ensureRepo } from "./repos.ts";
import {
	createRun,
	markActionExecuted,
	recordActions,
	recordSteps,
} from "./runs.ts";

/**
 * §9 rules-page stats over REAL stored data — repo-scoped, no new pipeline.
 * Proves matches come from rule-node fails, actioned counts only executed
 * enforcement kinds (never the always-emitted comment/check), and one repo's
 * activity never leaks into another's numbers.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
const SNAPSHOT = [DEFAULT_WORKFLOW];

async function seedEvent(id: string, repoFullName: string): Promise<string> {
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.opened",
		repoFullName,
	});
	return id;
}

async function seedRun(
	eventId: string,
	repoFullName: string,
	failedRefs: string[],
	enforcement: string[],
): Promise<string> {
	const runId = await createRun(db, {
		eventId,
		repoFullName,
		subjectNumber: 1,
		headSha: `sha-${eventId}`,
		snapshot: SNAPSHOT,
		status: "completed",
		verdict: "block",
	});
	const at = new Date().toISOString();
	await recordSteps(
		db,
		runId,
		failedRefs.map((ref, i) => ({
			nodeId: `default@1:rule-${i}`,
			nodeKind: "rule",
			ruleRef: ref,
			status: "fail",
			input: {},
			output: {
				ruleId: ref.split("@")[0],
				version: 1,
				status: "evaluated",
				passed: false,
				evidence: {},
				evaluatedAt: at,
			},
			startedAt: at,
			finishedAt: at,
			durationMs: 0,
		})),
	);
	const rows = await recordActions(
		db,
		runId,
		[...enforcement, "comment", "set-check"].map((kind, i) => ({
			kind,
			payload: {},
			idempotencyKey: `${kind}:${i}`,
		})),
	);
	for (const row of rows) {
		await markActionExecuted(db, row.id, null);
	}
	return runId;
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("getRulesStats — repo-scoped, real stored data", () => {
	test("matches from rule fails; actioned counts enforcement only, not comment/check", async () => {
		const eA = await seedEvent("evt-a", "acme/alpha");
		await seedRun(eA, "acme/alpha", ["account-age@1", "honeypot@1"], ["block"]);
		const eB = await seedEvent("evt-b", "acme/beta");
		await seedRun(eB, "acme/beta", ["crypto-address@1"], ["block", "label"]);

		const alpha = await insightServices.getRulesStats(db, {
			forge: "github",
			fullName: "acme/alpha",
		});
		expect(alpha.matches24h.value).toBe(2);
		// block executed, but the comment + set-check rows must NOT count.
		expect(alpha.actioned24h.value).toBe(1);
		expect(alpha.matches24h.series).toHaveLength(24);

		const byRef = new Map(alpha.perRule.map((r) => [r.ref, r]));
		expect(byRef.get("account-age@1")?.matches24h).toBe(1);
		expect(byRef.get("honeypot@1")?.matches24h).toBe(1);
		// beta's rule never appears in alpha's per-rule breakdown.
		expect(byRef.has("crypto-address@1")).toBe(false);

		const beta = await insightServices.getRulesStats(db, {
			forge: "github",
			fullName: "acme/beta",
		});
		expect(beta.matches24h.value).toBe(1);
		expect(beta.actioned24h.value).toBe(2);
	});

	test("flow and rule stats retain rolling windows, prior deltas, and hourly row filtering", async () => {
		const fullName = "acme/windows";
		for (const hours of [1, 25, 49]) {
			const eventId = await seedEvent(`window-${hours}`, fullName);
			const runId = await seedRun(
				eventId,
				fullName,
				["account-age@1"],
				["block"],
			);
			await db.execute(
				sql`UPDATE runs SET created_at = now() - make_interval(hours => ${hours}) WHERE id = ${runId}`,
			);
			await db.execute(
				sql`UPDATE run_steps SET started_at = now() - make_interval(hours => ${hours}) WHERE run_id = ${runId}`,
			);
			await db.execute(
				sql`UPDATE run_actions SET executed_at = now() - make_interval(hours => ${hours}) WHERE run_id = ${runId}`,
			);
		}
		const repo = { forge: "github", fullName } satisfies RepoIdentity;
		const home = await insightServices.getHomeStats(db, repo);
		expect(home.blocked.value).toBe(1);
		expect(home.blocked.delta).toBe(0);
		expect(home.blocked.series).toHaveLength(24);
		expect(home.blocked.series[22]).toBe(1);
		expect(home.blocked.series.reduce((sum, value) => sum + value, 0)).toBe(1);
		const rules = await insightServices.getRulesStats(db, repo);
		expect(rules.matches24h.value).toBe(1);
		expect(rules.matches24h.delta).toBe(0);
		expect(rules.actioned24h.value).toBe(1);
		expect(rules.actioned24h.delta).toBe(0);
		expect(rules.matches24h.series[22]).toBe(1);
		expect(rules.actioned24h.series[22]).toBe(1);
		expect(rules.perRule).toHaveLength(1);
		expect(rules.perRule[0]?.ref).toBe("account-age@1");
		expect(rules.perRule[0]?.matches24h).toBe(1);
		expect(
			rules.perRule[0]?.series.reduce((sum, value) => sum + value, 0),
		).toBe(1);
	});

	test("a repo with no runs reports honest zeros", async () => {
		const empty = await insightServices.getRulesStats(db, {
			forge: "github",
			fullName: "acme/nobody",
		});
		expect(empty.matches24h.value).toBe(0);
		expect(empty.actioned24h.value).toBe(0);
		expect(empty.perRule).toHaveLength(0);
	});

	test("per-rule series uses the same rolling hours-ago ordering as matches24h.series", async () => {
		const repo = "acme/ordering";
		const eventId = await seedEvent("evt-ordering", repo);
		const runId = await createRun(db, {
			eventId,
			repoFullName: repo,
			subjectNumber: 1,
			headSha: "sha-ordering",
			snapshot: SNAPSHOT,
			status: "completed",
			verdict: "block",
		});
		// Seed two rule-node fails at distinct offsets so the rolling index
		// (23 - h) is distinguishable from a clock-hour bucket. 5h ago → 18,
		// 10h ago → 13. Under the old clock-hour bucket these would land at
		// (currentHour - 5) and (currentHour - 10), disagreeing with the
		// top-level series.
		const at5h = new Date(Date.now() - 5 * 3600_000).toISOString();
		const at10h = new Date(Date.now() - 10 * 3600_000).toISOString();
		const ref5h = "ordering-5h@1";
		const ref10h = "ordering-10h@1";
		await recordSteps(db, runId, [
			{
				nodeId: "default@1:rule-0",
				nodeKind: "rule",
				ruleRef: ref5h,
				status: "fail",
				input: {},
				output: {
					ruleId: ref5h.split("@")[0],
					version: 1,
					status: "evaluated",
					passed: false,
					evidence: {},
					evaluatedAt: at5h,
				},
				startedAt: at5h,
				finishedAt: at5h,
				durationMs: 0,
			},
			{
				nodeId: "default@1:rule-1",
				nodeKind: "rule",
				ruleRef: ref10h,
				status: "fail",
				input: {},
				output: {
					ruleId: ref10h.split("@")[0],
					version: 1,
					status: "evaluated",
					passed: false,
					evidence: {},
					evaluatedAt: at10h,
				},
				startedAt: at10h,
				finishedAt: at10h,
				durationMs: 0,
			},
		]);

		const stats = await insightServices.getRulesStats(db, {
			forge: "github",
			fullName: repo,
		});

		// Top-level series: 5h fail at 23 - 5 = 18, 10h fail at 23 - 10 = 13.
		expect(stats.matches24h.series.findIndex((x) => x > 0)).toBe(13);
		expect(stats.matches24h.series[18]).toBe(1);
		expect(stats.matches24h.series[13]).toBe(1);

		// Per-rule series: the SAME fail must land at the SAME rolling index
		// — the sparkline contract is "oldest first, index 23 = now", and
		// the per-rule series flows unchanged into <Sparkline data={rule.trend}>.
		const byRef = new Map(stats.perRule.map((r) => [r.ref, r]));
		const perRule5h = byRef.get(ref5h);
		expect(perRule5h).toBeDefined();
		expect(perRule5h?.series.findIndex((x) => x > 0)).toBe(18);
		expect(perRule5h?.matches24h).toBe(1);

		const perRule10h = byRef.get(ref10h);
		expect(perRule10h).toBeDefined();
		expect(perRule10h?.series.findIndex((x) => x > 0)).toBe(13);
		expect(perRule10h?.matches24h).toBe(1);
	});
});

describe("getHomeStats — the number and its series tell one story", () => {
	let seq = 0;
	async function seedVerdictRun(
		repoFullName: string,
		verdict: "block" | "pass" | "needs_review" | "changes_required" | "close",
	): Promise<string> {
		const id = `home-${seq++}`;
		const eventId = await seedEvent(id, repoFullName);
		return createRun(db, {
			eventId,
			repoFullName,
			subjectNumber: 1,
			headSha: `sha-${id}`,
			snapshot: SNAPSHOT,
			status: "completed",
			verdict,
		});
	}

	test("sentToReview is the current queue depth; series[23] IS the value", async () => {
		const repo = "acme/home";
		// Two blocks + one pass + one still awaiting review (24h flow counts).
		await seedVerdictRun(repo, "block");
		await seedVerdictRun(repo, "block");
		await seedVerdictRun(repo, "pass");
		const reviewRun = await seedVerdictRun(repo, "needs_review");
		// The paused run becomes a pending moderation item — the live queue.
		await db.insert(moderationItems).values({
			id: "mi-home-1",
			runId: reviewRun,
			nodeId: "default@1:review",
			status: "pending",
		});

		const stats = await insightServices.getHomeStats(db, {
			forge: "github",
			fullName: repo,
		});

		// The whole bug: the last point of the queue series equals the number.
		expect(stats.sentToReview.value).toBe(1);
		expect(stats.sentToReview.series).toHaveLength(24);
		expect(stats.sentToReview.series[23]).toBe(stats.sentToReview.value);

		expect(stats.blocked.value).toBe(2);
		expect(stats.passed.value).toBe(1);
		expect(stats.blocked.series).toHaveLength(24);
		expect(stats.passed.series).toHaveLength(24);
	});

	test("changes needed and closed count as held next to blocked", async () => {
		const repo = "acme/held";
		await seedVerdictRun(repo, "block");
		await seedVerdictRun(repo, "changes_required");
		await seedVerdictRun(repo, "close");
		await seedVerdictRun(repo, "pass");
		const stats = await insightServices.getHomeStats(db, {
			forge: "github",
			fullName: repo,
		});
		expect(stats.blocked.value).toBe(3);
		expect(stats.blocked.series.reduce((sum, n) => sum + n, 0)).toBe(3);
		expect(stats.passed.value).toBe(1);
		const recent = await insightServices.listRecentRuns(db, {
			verdicts: ["block", "changes_required", "close"],
			repo: { forge: "github", fullName: repo },
		});
		expect(recent.map((run) => run.verdict).sort()).toEqual([
			"block",
			"changes_required",
			"close",
		]);
	});

	test("the daily rollup counts changes needed and closed as blocked", async () => {
		const repo = "acme/rolled";
		const repoId = await ensureRepo(db, {
			externalId: "rolled-1",
			owner: "acme",
			name: "rolled",
			fullName: repo,
		});
		await seedVerdictRun(repo, "block");
		await seedVerdictRun(repo, "changes_required");
		await seedVerdictRun(repo, "close");
		await seedVerdictRun(repo, "pass");
		const today = new Date().toISOString().slice(0, 10);
		await insightServices.computeDailyRollups(db, today);
		const [row] = await db
			.select({ blocked: rollupsDaily.blocked, passed: rollupsDaily.passed })
			.from(rollupsDaily)
			.where(eq(rollupsDaily.repoId, repoId));
		expect(row).toEqual({ blocked: 3, passed: 1 });
	});

	test("a repo with no activity reports honest zeros, not a faked line", async () => {
		const empty = await insightServices.getHomeStats(db, {
			forge: "github",
			fullName: "acme/quiet",
		});
		expect(empty.sentToReview.value).toBe(0);
		expect(empty.blocked.value).toBe(0);
		expect(empty.passed.value).toBe(0);
		// An all-zero series is what the card renders as "not enough data".
		expect(empty.sentToReview.series.every((n) => n === 0)).toBe(true);
	});
});
