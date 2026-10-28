import type { RepoIdentity } from "@tripwire/contracts";
import {
	HELD_VERDICTS,
	type ModStat,
	type ModStats,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { runSteps, runs } from "../schema/runs.ts";
import { eventBearsVerdict, runBearsVerdict } from "./runs.ts";

/**
 * Rollups + Home stats (§4). `computeDailyRollups` is the worker's daily job;
 * `getHomeStats` feeds the Home stat cards with REAL data in the demo's
 * ModStats contract shape (value, signed delta, 24h hourly series).
 */

export async function computeDailyRollups(db: Db, day: string): Promise<void> {
	await computeRollupsBetween(db, day, day);
}

export async function computeRollupsBetween(
	db: Db,
	fromDay: string,
	toDay: string,
): Promise<void> {
	await db.execute(sql`
		INSERT INTO rollups_daily (id, repo_id, day, events, runs, passed, blocked, sent_to_review)
		SELECT
			${generateId()} || substr(md5(r.id || d.day::text), 1, 16),
			r.id,
			d.day,
			COALESCE(e.n, 0),
			COALESCE(x.n, 0),
			COALESCE(x.passed, 0),
			COALESCE(x.blocked, 0),
			COALESCE(x.review, 0)
		FROM repos r
		CROSS JOIN (
			SELECT generate_series(${fromDay}::date, ${toDay}::date, interval '1 day')::date AS day
		) d
		LEFT JOIN (
			SELECT forge, repo_full_name, received_at::date AS day, count(*)::int AS n
			FROM events
			WHERE received_at::date BETWEEN ${fromDay}::date AND ${toDay}::date
			GROUP BY forge, repo_full_name, received_at::date
		) e ON e.forge = r.forge AND e.repo_full_name = r.full_name AND e.day = d.day
		LEFT JOIN (
			SELECT ev.forge, runs.repo_full_name, runs.created_at::date AS day,
				count(*)::int AS n,
				count(*) FILTER (WHERE verdict = 'pass')::int AS passed,
				count(*) FILTER (WHERE verdict IN ('block', 'changes_required', 'close'))::int AS blocked,
				count(*) FILTER (WHERE verdict = 'needs_review')::int AS review
			FROM runs JOIN events ev ON ev.id = runs.event_id
			WHERE runs.created_at::date BETWEEN ${fromDay}::date AND ${toDay}::date
			  AND ${runBearsVerdict}
			GROUP BY ev.forge, runs.repo_full_name, runs.created_at::date
		) x ON x.forge = r.forge AND x.repo_full_name = r.full_name AND x.day = d.day
		ON CONFLICT (repo_id, day) DO UPDATE SET
			events = EXCLUDED.events,
			runs = EXCLUDED.runs,
			passed = EXCLUDED.passed,
			blocked = EXCLUDED.blocked,
			sent_to_review = EXCLUDED.sent_to_review
	`);
}

interface AgoRow {
	h: number;
	n: number;
}

/**
 * A ROLLING 24h hourly series bucketed by hours-ago (0 = the current hour). The
 * returned array is oldest-first (index 0 = 23h ago, index 23 = now), so the
 * chart's right edge is "now" and the window fills honestly — never the
 * clock-hour clustering the old `extract(hour …)` produced.
 */
async function rollingSeries(db: Db, query: ReturnType<typeof sql>) {
	const result = await db.execute(query);
	const rows = result.rows as unknown as AgoRow[];
	const series = Array.from({ length: 24 }, () => 0);
	for (const row of rows) {
		const h = Number(row.h);
		if (h >= 0 && h < 24) {
			series[23 - h] = Number(row.n);
		}
	}
	return series;
}

/**
 * Real Home stats (§13.10), SCOPED to the user's active repo. Each stat's value
 * and series describe the SAME window: `blocked`/`passed` are 24h flow;
 * `sentToReview` is the CURRENT queue depth with a 24h queue-DEPTH series whose
 * last point equals the value (the number and the chart tell one story).
 * Moderation items reach the repo through their run.
 */
export async function getHomeStats(
	db: Db,
	repo: RepoIdentity,
): Promise<ModStats> {
	const scalar = async (query: ReturnType<typeof sql>): Promise<number> => {
		const result = await db.execute(query);
		return Number(
			(result.rows[0] as Record<string, unknown> | undefined)?.n ?? 0,
		);
	};

	// moderation_items carry no repo column — scope them through their run.
	const inRepo = sql`run_id IN (SELECT id FROM runs WHERE repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = runs.event_id AND scope_event.forge = ${repo.forge}))`;
	const ofRepo = sql`repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = runs.event_id AND scope_event.forge = ${repo.forge})`;

	// A rolling 24h flow series bucketed by hours-ago, for a run verdict.
	const verdictIn = (verdicts: readonly string[]) =>
		sql`verdict IN (${sql.join(
			verdicts.map((verdict) => sql`${verdict}`),
			sql`, `,
		)})`;
	const verdictSeries = (verdicts: readonly string[]) =>
		rollingSeries(
			db,
			sql`SELECT floor(extract(epoch FROM (now() - created_at)) / 3600)::int AS h,
			           count(*)::int AS n
			    FROM runs
			    WHERE ${verdictIn(verdicts)} AND ${ofRepo} AND ${runBearsVerdict}
			      AND created_at > now() - interval '24 hours'
			    GROUP BY 1`,
		);
	const count24 = (verdicts: readonly string[]) =>
		scalar(
			sql`SELECT count(*)::int AS n FROM runs
			    WHERE ${verdictIn(verdicts)} AND ${ofRepo} AND ${runBearsVerdict}
			      AND created_at > now() - interval '24 hours'`,
		);
	const countPrev = (verdicts: readonly string[]) =>
		scalar(
			sql`SELECT count(*)::int AS n FROM runs
			    WHERE ${verdictIn(verdicts)} AND ${ofRepo} AND ${runBearsVerdict}
			      AND created_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'`,
		);

	const [blocked24, blockedPrev, blockedSeries] = await Promise.all([
		count24(HELD_VERDICTS),
		countPrev(HELD_VERDICTS),
		verdictSeries(HELD_VERDICTS),
	]);
	const [passed24, passedPrev, passedSeries] = await Promise.all([
		count24(["pass"]),
		countPrev(["pass"]),
		verdictSeries(["pass"]),
	]);

	// sentToReview: the CURRENT queue depth, with a 24h queue-depth series whose
	// last point IS the value. depth(t) = items created by t and not yet decided
	// by t. h=0 is the current hour, so series[23] = depth(now) = queue.
	const pending = await scalar(
		sql`SELECT count(*)::int AS n FROM moderation_items
		    WHERE status = 'pending' AND ${inRepo}`,
	);
	const pendingPrev = await scalar(
		sql`SELECT count(*)::int AS n FROM moderation_items mi
		    WHERE created_at <= now() - interval '24 hours'
		      AND (decided_at IS NULL OR decided_at > now() - interval '24 hours')
		      AND ${inRepo}`,
	);
	const queueSeries = await rollingSeries(
		db,
		sql`WITH b AS (SELECT h, now() - make_interval(hours => h) AS t FROM generate_series(0, 23) AS h)
		    SELECT b.h,
		           (SELECT count(*)::int FROM moderation_items mi
		            WHERE mi.created_at <= b.t
		              AND (mi.decided_at IS NULL OR mi.decided_at > b.t)
		              AND mi.run_id IN (SELECT id FROM runs WHERE repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = runs.event_id AND scope_event.forge = ${repo.forge}))
		           ) AS n
		    FROM b`,
	);

	return {
		sentToReview: {
			value: pending,
			delta: pending - pendingPrev,
			series: queueSeries,
		},
		blocked: {
			value: blocked24,
			delta: blocked24 - blockedPrev,
			series: blockedSeries,
		},
		passed: {
			value: passed24,
			delta: passed24 - passedPrev,
			series: passedSeries,
		},
	};
}

export interface RunActivityRow {
	runId: string;
	verdict: string | null;
	status: string;
	repoFullName: string;
	subjectNumber: number | null;
	actorLogin: string | null;
	ruleCount: number;
	failedCount: number;
	createdAt: Date;
}

/** Recent runs (optionally filtered by verdict) — the activity behind a metric. */
export async function listRecentRuns(
	db: Db,
	opts: {
		verdicts?: string[];
		limit?: number;
		repo?: RepoIdentity;
		since?: Date;
		until?: Date;
	} = {},
): Promise<RunActivityRow[]> {
	const limit = opts.limit ?? 20;
	const rows = await db
		.select({
			runId: runs.id,
			verdict: runs.verdict,
			status: runs.status,
			repoFullName: runs.repoFullName,
			subjectNumber: runs.subjectNumber,
			createdAt: runs.createdAt,
			actorLogin: events.actorLogin,
		})
		.from(runs)
		.leftJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				opts.verdicts ? inArray(runs.verdict, opts.verdicts) : undefined,
				opts.verdicts ? eventBearsVerdict : undefined,
				opts.verdicts ? ne(runs.status, "closed") : undefined,
				opts.repo
					? and(
							eq(runs.repoFullName, opts.repo.fullName),
							sql`${events.forge} = ${opts.repo.forge}`,
						)
					: undefined,
				opts.since ? gte(runs.createdAt, opts.since) : undefined,
				opts.until ? lt(runs.createdAt, opts.until) : undefined,
			),
		)
		.orderBy(desc(runs.createdAt))
		.limit(limit);

	const ids = rows.map((r) => r.runId);
	const counts = ids.length
		? await db
				.select({
					runId: runSteps.runId,
					ruleCount: sql<number>`count(*) filter (where ${runSteps.nodeKind} = 'rule')::int`,
					failedCount: sql<number>`count(*) filter (where ${runSteps.nodeKind} = 'rule' and ${runSteps.status} = 'fail')::int`,
				})
				.from(runSteps)
				.where(inArray(runSteps.runId, ids))
				.groupBy(runSteps.runId)
		: [];
	const countByRun = new Map(counts.map((c) => [c.runId, c]));

	return rows.map((r) => ({
		runId: r.runId,
		verdict: r.verdict,
		status: r.status,
		repoFullName: r.repoFullName,
		subjectNumber: r.subjectNumber,
		actorLogin: r.actorLogin,
		ruleCount: countByRun.get(r.runId)?.ruleCount ?? 0,
		failedCount: countByRun.get(r.runId)?.failedCount ?? 0,
		createdAt: r.createdAt,
	}));
}

export interface DecisionActivityRow {
	itemId: string;
	runId: string;
	status: string;
	repoFullName: string;
	subjectNumber: number | null;
	actorLogin: string | null;
	decidedAt: Date | null;
}

/**
 * Enforcement action kinds counted as "actioned" (§9 rules header). The PR
 * surface artifacts — `comment` and `set-check` — are emitted on EVERY run
 * (a passing run still posts a success check), so counting them would report
 * passes as enforcement. Only these discrete enforcement verbs count.
 */
const ENFORCEMENT_KINDS = [
	"block",
	"label",
	"request-review",
	"send-to-moderation",
	"hide-comment",
];
const ENFORCEMENT_LIST = sql.join(
	ENFORCEMENT_KINDS.map((kind) => sql`${kind}`),
	sql`, `,
);

export interface RuleStat {
	/** `id@version` as stored in run_steps.rule_id. */
	ref: string;
	matches24h: number;
	/** Hourly fail counts over the last 24h — the card sparkline. */
	series: number[];
}

export interface RulesStats {
	/** Rule-node fails across runs for this repo, last 24h. */
	matches24h: ModStat;
	/** Executed enforcement actions for this repo, last 24h. */
	actioned24h: ModStat;
	perRule: RuleStat[];
}

/**
 * Real per-repo rules-page stats over stored data (§9) — no new pipeline:
 * matches from `run_steps` (rule-node fails), actioned from `run_actions`
 * (executed enforcement kinds). FP rate is intentionally absent — reversals
 * aren't tracked yet, so the caller renders "not enough data" (§6 loop).
 */
export async function getRulesStats(
	db: Db,
	repo: RepoIdentity,
): Promise<RulesStats> {
	const scalar = async (query: ReturnType<typeof sql>): Promise<number> => {
		const result = await db.execute(query);
		return Number(
			(result.rows[0] as Record<string, unknown> | undefined)?.n ?? 0,
		);
	};

	const matches24h = await scalar(sql`
		SELECT count(*)::int AS n FROM run_steps s
		JOIN runs r ON r.id = s.run_id
		WHERE r.repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = r.event_id AND scope_event.forge = ${repo.forge})
		  AND s.node_kind = 'rule' AND s.status = 'fail'
		  AND s.started_at > now() - interval '24 hours'`);
	const matchesPrev = await scalar(sql`
		SELECT count(*)::int AS n FROM run_steps s
		JOIN runs r ON r.id = s.run_id
		WHERE r.repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = r.event_id AND scope_event.forge = ${repo.forge})
		  AND s.node_kind = 'rule' AND s.status = 'fail'
		  AND s.started_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'`);
	const matchesSeries = await rollingSeries(
		db,
		sql`SELECT floor(extract(epoch FROM (now() - s.started_at)) / 3600)::int AS h,
		           count(*)::int AS n
		    FROM run_steps s JOIN runs r ON r.id = s.run_id
		    WHERE r.repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = r.event_id AND scope_event.forge = ${repo.forge})
		      AND s.node_kind = 'rule' AND s.status = 'fail'
		      AND s.started_at > now() - interval '24 hours'
		    GROUP BY 1`,
	);

	const actioned24h = await scalar(sql`
		SELECT count(*)::int AS n FROM run_actions a
		JOIN runs r ON r.id = a.run_id
		WHERE r.repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = r.event_id AND scope_event.forge = ${repo.forge})
		  AND a.status = 'executed' AND a.kind IN (${ENFORCEMENT_LIST})
		  AND a.executed_at > now() - interval '24 hours'`);
	const actionedPrev = await scalar(sql`
		SELECT count(*)::int AS n FROM run_actions a
		JOIN runs r ON r.id = a.run_id
		WHERE r.repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = r.event_id AND scope_event.forge = ${repo.forge})
		  AND a.status = 'executed' AND a.kind IN (${ENFORCEMENT_LIST})
		  AND a.executed_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'`);
	const actionedSeries = await rollingSeries(
		db,
		sql`SELECT floor(extract(epoch FROM (now() - a.executed_at)) / 3600)::int AS h,
		           count(*)::int AS n
		    FROM run_actions a JOIN runs r ON r.id = a.run_id
		    WHERE r.repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = r.event_id AND scope_event.forge = ${repo.forge})
		      AND a.status = 'executed' AND a.kind IN (${ENFORCEMENT_LIST})
		      AND a.executed_at > now() - interval '24 hours'
		    GROUP BY 1`,
	);

	const perRuleResult = await db.execute(sql`
		SELECT s.rule_id AS ref,
		       extract(hour FROM s.started_at)::int AS bucket,
		       count(*)::int AS n
		FROM run_steps s JOIN runs r ON r.id = s.run_id
		WHERE r.repo_full_name = ${repo.fullName} AND EXISTS (SELECT 1 FROM events scope_event WHERE scope_event.id = r.event_id AND scope_event.forge = ${repo.forge})
		  AND s.node_kind = 'rule' AND s.status = 'fail'
		  AND s.rule_id IS NOT NULL
		  AND s.started_at > now() - interval '24 hours'
		GROUP BY 1, 2`);
	const perRuleMap = new Map<string, RuleStat>();
	for (const row of perRuleResult.rows as unknown as {
		ref: string;
		bucket: number;
		n: number;
	}[]) {
		let stat = perRuleMap.get(row.ref);
		if (!stat) {
			stat = { ref: row.ref, matches24h: 0, series: Array(24).fill(0) };
			perRuleMap.set(row.ref, stat);
		}
		const index = Number(row.bucket);
		stat.matches24h += Number(row.n);
		if (index >= 0 && index < 24) {
			stat.series[index] = Number(row.n);
		}
	}

	return {
		matches24h: {
			value: matches24h,
			delta: matches24h - matchesPrev,
			series: matchesSeries,
		},
		actioned24h: {
			value: actioned24h,
			delta: actioned24h - actionedPrev,
			series: actionedSeries,
		},
		perRule: [...perRuleMap.values()],
	};
}

/** Recent moderation decisions — the activity behind "resolved". */
export async function listRecentDecisions(
	db: Db,
	limit = 20,
): Promise<DecisionActivityRow[]> {
	return await db
		.select({
			itemId: moderationItems.id,
			runId: moderationItems.runId,
			status: moderationItems.status,
			repoFullName: runs.repoFullName,
			subjectNumber: runs.subjectNumber,
			actorLogin: events.actorLogin,
			decidedAt: moderationItems.decidedAt,
		})
		.from(moderationItems)
		.innerJoin(runs, eq(runs.id, moderationItems.runId))
		.leftJoin(events, eq(events.id, runs.eventId))
		.where(inArray(moderationItems.status, ["approved", "denied"]))
		.orderBy(desc(moderationItems.decidedAt))
		.limit(limit);
}
