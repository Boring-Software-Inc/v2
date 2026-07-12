import type { ModStat, ModStats } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { runSteps, runs } from "../schema/runs.ts";

/**
 * Rollups + Home stats (§4). `computeDailyRollups` is the worker's daily job;
 * `getHomeStats` feeds the Home stat cards with REAL data in the demo's
 * ModStats contract shape (value, signed delta, 24h hourly series).
 */

export async function computeDailyRollups(db: Db, day: string): Promise<void> {
	await db.execute(sql`
		INSERT INTO rollups_daily (id, repo_id, day, events, runs, passed, blocked, sent_to_review)
		SELECT
			${generateId()} || substr(md5(r.id), 1, 8),
			r.id,
			${day}::date,
			COALESCE(e.n, 0),
			COALESCE(x.n, 0),
			COALESCE(x.passed, 0),
			COALESCE(x.blocked, 0),
			COALESCE(x.review, 0)
		FROM repos r
		LEFT JOIN (
			SELECT repo_full_name, count(*)::int AS n
			FROM events
			WHERE received_at::date = ${day}::date
			GROUP BY repo_full_name
		) e ON e.repo_full_name = r.full_name
		LEFT JOIN (
			SELECT repo_full_name,
				count(*)::int AS n,
				count(*) FILTER (WHERE verdict = 'pass')::int AS passed,
				count(*) FILTER (WHERE verdict = 'block')::int AS blocked,
				count(*) FILTER (WHERE verdict = 'needs_review')::int AS review
			FROM runs
			WHERE created_at::date = ${day}::date
			GROUP BY repo_full_name
		) x ON x.repo_full_name = r.full_name
		ON CONFLICT (repo_id, day) DO UPDATE SET
			events = EXCLUDED.events,
			runs = EXCLUDED.runs,
			passed = EXCLUDED.passed,
			blocked = EXCLUDED.blocked,
			sent_to_review = EXCLUDED.sent_to_review
	`);
}

interface HourlyRow {
	bucket: number;
	n: number;
}

async function hourlySeries(db: Db, query: ReturnType<typeof sql>) {
	const result = await db.execute(query);
	const rows = result.rows as unknown as HourlyRow[];
	const series = Array.from({ length: 24 }, () => 0);
	for (const row of rows) {
		const index = Number(row.bucket);
		if (index >= 0 && index < 24) {
			series[index] = Number(row.n);
		}
	}
	return series;
}

/** Real Home stats in the demo's ModStats contract shape. */
export async function getHomeStats(db: Db): Promise<ModStats> {
	const scalar = async (query: ReturnType<typeof sql>): Promise<number> => {
		const result = await db.execute(query);
		return Number(
			(result.rows[0] as Record<string, unknown> | undefined)?.n ?? 0,
		);
	};

	const pending = await scalar(
		sql`SELECT count(*)::int AS n FROM moderation_items WHERE status = 'pending'`,
	);
	const pendingYesterday = await scalar(
		sql`SELECT count(*)::int AS n FROM moderation_items
		    WHERE status = 'pending' AND created_at < now() - interval '24 hours'`,
	);
	const resolvedToday = await scalar(
		sql`SELECT count(*)::int AS n FROM moderation_items
		    WHERE decided_at::date = now()::date`,
	);
	const resolvedYesterday = await scalar(
		sql`SELECT count(*)::int AS n FROM moderation_items
		    WHERE decided_at::date = (now() - interval '1 day')::date`,
	);
	const blocked24 = await scalar(
		sql`SELECT count(*)::int AS n FROM runs
		    WHERE verdict = 'block' AND created_at > now() - interval '24 hours'`,
	);
	const blockedPrev = await scalar(
		sql`SELECT count(*)::int AS n FROM runs
		    WHERE verdict = 'block'
		      AND created_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'`,
	);

	const moderationSeries = await hourlySeries(
		db,
		sql`SELECT extract(hour FROM created_at)::int AS bucket, count(*)::int AS n
		    FROM moderation_items WHERE created_at > now() - interval '24 hours'
		    GROUP BY 1`,
	);
	const blockedSeries = await hourlySeries(
		db,
		sql`SELECT extract(hour FROM created_at)::int AS bucket, count(*)::int AS n
		    FROM runs WHERE verdict = 'block' AND created_at > now() - interval '24 hours'
		    GROUP BY 1`,
	);

	return {
		pendingReports: {
			value: pending,
			delta: pending - pendingYesterday,
			series: moderationSeries,
		},
		resolvedToday: {
			value: resolvedToday,
			delta: resolvedToday - resolvedYesterday,
			series: moderationSeries,
		},
		automodHits24h: {
			value: blocked24,
			delta: blocked24 - blockedPrev,
			series: blockedSeries,
		},
		/** No ban concept yet — honest zeros beat repurposed numbers. */
		bannedUsers: {
			value: 0,
			delta: 0,
			series: Array.from({ length: 24 }, () => 0),
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
	opts: { verdicts?: string[]; limit?: number } = {},
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
		.where(opts.verdicts ? inArray(runs.verdict, opts.verdicts) : undefined)
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
	repoFullName: string,
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
		WHERE r.repo_full_name = ${repoFullName}
		  AND s.node_kind = 'rule' AND s.status = 'fail'
		  AND s.started_at > now() - interval '24 hours'`);
	const matchesPrev = await scalar(sql`
		SELECT count(*)::int AS n FROM run_steps s
		JOIN runs r ON r.id = s.run_id
		WHERE r.repo_full_name = ${repoFullName}
		  AND s.node_kind = 'rule' AND s.status = 'fail'
		  AND s.started_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'`);
	const matchesSeries = await hourlySeries(
		db,
		sql`SELECT extract(hour FROM s.started_at)::int AS bucket, count(*)::int AS n
		    FROM run_steps s JOIN runs r ON r.id = s.run_id
		    WHERE r.repo_full_name = ${repoFullName}
		      AND s.node_kind = 'rule' AND s.status = 'fail'
		      AND s.started_at > now() - interval '24 hours'
		    GROUP BY 1`,
	);

	const actioned24h = await scalar(sql`
		SELECT count(*)::int AS n FROM run_actions a
		JOIN runs r ON r.id = a.run_id
		WHERE r.repo_full_name = ${repoFullName}
		  AND a.status = 'executed' AND a.kind IN (${ENFORCEMENT_LIST})
		  AND a.executed_at > now() - interval '24 hours'`);
	const actionedPrev = await scalar(sql`
		SELECT count(*)::int AS n FROM run_actions a
		JOIN runs r ON r.id = a.run_id
		WHERE r.repo_full_name = ${repoFullName}
		  AND a.status = 'executed' AND a.kind IN (${ENFORCEMENT_LIST})
		  AND a.executed_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'`);
	const actionedSeries = await hourlySeries(
		db,
		sql`SELECT extract(hour FROM a.executed_at)::int AS bucket, count(*)::int AS n
		    FROM run_actions a JOIN runs r ON r.id = a.run_id
		    WHERE r.repo_full_name = ${repoFullName}
		      AND a.status = 'executed' AND a.kind IN (${ENFORCEMENT_LIST})
		      AND a.executed_at > now() - interval '24 hours'
		    GROUP BY 1`,
	);

	const perRuleResult = await db.execute(sql`
		SELECT s.rule_id AS ref,
		       extract(hour FROM s.started_at)::int AS bucket,
		       count(*)::int AS n
		FROM run_steps s JOIN runs r ON r.id = s.run_id
		WHERE r.repo_full_name = ${repoFullName}
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
