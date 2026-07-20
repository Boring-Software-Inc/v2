import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { events } from "./events.ts";

/**
 * Runs + steps + actions (spec §4/§5). A run snapshots its workflow definition
 * (§5.10) so editing a workflow never changes what a historical run page shows.
 * Actions are recorded as rows FIRST and marked executed after (§5.12) so a
 * crash mid-run can never double-block on retry.
 */
export const runs = pgTable(
	"runs",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id),
		repoFullName: text("repo_full_name").notNull(),
		/** The change-request number the run gates, when applicable. */
		subjectNumber: integer("subject_number"),
		headSha: text("head_sha"),
		/**
		 * queued (re-run materialised at enqueue) → running → completed | paused
		 * (needs_review moderation, §6) | failed (never evaluated).
		 */
		status: text("status").notNull().default("running"),
		/** 'pass' | 'block' | 'needs_review' — null while running. */
		verdict: text("verdict"),
		/** SNAPSHOT of the workflow definition(s) that ran (contracts schema). */
		workflowSnapshot: jsonb("workflow_snapshot").notNull(),
		/**
		 * User id of the admin who manually triggered this run (re-run action).
		 * Null = webhook-driven. Public run views show the FACT of a manual
		 * re-run, never the actor (§10).
		 */
		triggeredBy: text("triggered_by"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(t) => [
		index("runs_repo_created_idx").on(t.repoFullName, t.createdAt),
		index("runs_event_idx").on(t.eventId),
		index("runs_head_sha_idx").on(t.headSha),
	],
);

export const runSteps = pgTable(
	"run_steps",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id),
		/** The workflow node this step executed. */
		nodeId: text("node_id").notNull(),
		nodeKind: text("node_kind").notNull(),
		/** `id@version` for rule nodes (versioning law, §6). */
		ruleId: text("rule_id"),
		/** RuleResult status: passed | failed | skipped — or gate/action outcome. */
		status: text("status").notNull(),
		input: jsonb("input"),
		output: jsonb("output"),
		/** Rule-specific typed evidence (contracts RuleResult, validated on write). */
		evidence: jsonb("evidence"),
		/**
		 * §10 public partition — the contributor-facing evidence subset + a
		 * plain-English one-liner, projected by the rule (core) at persist time.
		 * The public run page serves THESE; thresholds/trace stay in `evidence`
		 * for the session view. Null for pre-§10 runs (public view degrades).
		 */
		publicEvidence: jsonb("public_evidence"),
		summary: text("summary"),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
		durationMs: integer("duration_ms").notNull(),
	},
	(t) => [index("run_steps_run_idx").on(t.runId)],
);

export const runActions = pgTable(
	"run_actions",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id),
		/** block | label | comment | request-review | send-to-moderation | set-check */
		kind: text("kind").notNull(),
		/** Everything the adapter needs to execute (contracts schema per kind). */
		payload: jsonb("payload").notNull(),
		/**
		 * Retry-dedupe key within the run, e.g. `comment:<repo>#<nr>` or
		 * `check:<sha>`. Cross-run artifact identity (ONE comment per PR, one
		 * check per SHA) is the adapter's upsert job, not a table constraint.
		 */
		idempotencyKey: text("idempotency_key").notNull(),
		/** recorded → executed (§5.12). */
		status: text("status").notNull().default("recorded"),
		recordedAt: timestamp("recorded_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		executedAt: timestamp("executed_at", { withTimezone: true }),
		/** Forge-side id of the artifact (comment id, check run id) once executed. */
		externalId: text("external_id"),
	},
	(t) => [
		uniqueIndex("run_actions_idempotency_unique").on(t.runId, t.idempotencyKey),
		index("run_actions_run_idx").on(t.runId),
	],
);
