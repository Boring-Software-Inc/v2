import {
	type AiReviewOutput,
	DEFAULT_WORKFLOW,
	type Finding,
	type NormalizedEvent,
	type Verdict,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { events } from "./schema/events.ts";
import * as insightServices from "./services/insights.ts";
import * as moderationServices from "./services/moderation.ts";
import * as repoServices from "./services/repos.ts";
import * as runServices from "./services/runs.ts";

/**
 * Dev/demo seeding (§13) — SHAPE-CORRECT fixtures over the real services, used
 * by BOTH the dev persona switcher (auto-created fixtures) and `dev:demo` (the
 * seeded story). Runs are constructed to satisfy the same contracts the worker
 * writes (snapshot, RuleResult step envelopes, public evidence + summary,
 * recorded-then-executed actions) — `@tripwire/db` cannot import core, so this
 * mirrors the shape rather than invoking the executor (§13 permits either).
 *
 * Everything lives under the `tripwire-demo/*` repo namespace and `demo-*` ids,
 * so `resetDemoData` can wipe ONLY seeded rows and never a real table.
 */

/** The one owner every seeded repo hangs under — the reset key. */
export const DEMO_OWNER = "tripwire-demo";
/** Seeded users carry this email domain, so reset finds them (auth owns them). */
export const DEMO_EMAIL_DOMAIN = "tripwire.demo";

const HOUR = 60 * 60 * 1000;

function demoRepoRef(name: string) {
	return {
		externalId: `demo-repo-${name}`,
		owner: DEMO_OWNER,
		name,
		fullName: `${DEMO_OWNER}/${name}`,
	};
}

/** A showcase workflow that runs ai-review then blocks — for the findings demo. */
const AI_REVIEW_WORKFLOW: WorkflowDefinition = {
	id: "ai-review@1",
	name: "ai review gate",
	version: 1,
	nodes: [
		{
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
		{ id: "ai", type: "rule", ref: "ai-review@2", config: { maxSteps: 12 } },
		{ id: "gate", type: "gate", mode: "all-of" },
		{ id: "block", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "trigger", to: "ai" },
		{ id: "e2", from: "ai", to: "gate" },
		{ id: "e3", from: "gate", to: "block", when: "fail" },
	],
};

interface Contributor {
	login: string;
	externalId: string;
	avatarUrl?: string;
}

function changeRequestEvent(input: {
	eventId: string;
	repo: { externalId: string; owner: string; name: string; fullName: string };
	actor: Contributor;
	number: number;
	title: string;
	headSha: string;
	at: Date;
}): NormalizedEvent {
	const iso = input.at.toISOString();
	return {
		id: input.eventId,
		forge: "github",
		deliveryId: `demo-${input.eventId}`,
		repo: {
			owner: input.repo.owner,
			name: input.repo.name,
			fullName: input.repo.fullName,
		},
		repoExternalId: input.repo.externalId,
		actor: input.actor,
		occurredAt: iso,
		receivedAt: iso,
		kind: "change-request.opened",
		changeRequest: {
			number: input.number,
			title: input.title,
			headSha: input.headSha,
			baseRef: "main",
			headRef: `contrib/${input.number}`,
			draft: false,
			url: `https://github.com/${input.repo.fullName}/pull/${input.number}`,
		},
	};
}

async function insertEvent(db: Db, normalized: NormalizedEvent): Promise<void> {
	if (normalized.kind !== "change-request.opened") {
		return;
	}
	await db.insert(events).values({
		id: normalized.id,
		forge: "github",
		deliveryId: normalized.deliveryId,
		rawKind: "pull_request",
		raw: {},
		receivedAt: new Date(normalized.receivedAt),
		kind: normalized.kind,
		repoFullName: normalized.repo.fullName,
		actorLogin: normalized.actor.login,
		subjectNumber: normalized.changeRequest.number,
		headSha: normalized.changeRequest.headSha,
		normalized,
		normalizedAt: new Date(normalized.receivedAt),
	});
}

/** A rule step's RuleResult envelope (what the executor produces per rule). */
function ruleStep(input: {
	nodeId: string;
	ref: string;
	passed: boolean;
	evidence: unknown;
	at: Date;
	publicEvidence?: unknown;
	summary?: string;
}): runServices.RecordStepInput {
	const [ruleId, version] = input.ref.split("@");
	const iso = input.at.toISOString();
	return {
		nodeId: input.nodeId,
		nodeKind: "rule",
		ruleRef: input.ref,
		status: input.passed ? "pass" : "fail",
		input: {},
		output: {
			ruleId,
			version: Number(version),
			status: "evaluated",
			passed: input.passed,
			evidence: input.evidence,
			evaluatedAt: iso,
		},
		publicEvidence: input.publicEvidence,
		summary: input.summary ?? null,
		startedAt: iso,
		finishedAt: iso,
		durationMs: 4,
	};
}

function nonRuleStep(input: {
	nodeId: string;
	nodeKind: string;
	status: string;
	at: Date;
}): runServices.RecordStepInput {
	const iso = input.at.toISOString();
	return {
		nodeId: input.nodeId,
		nodeKind: input.nodeKind,
		status: input.status,
		input: {},
		output: {},
		startedAt: iso,
		finishedAt: iso,
		durationMs: 1,
	};
}

async function backdateRun(db: Db, runId: string, at: Date): Promise<void> {
	await db.execute(
		sql`UPDATE runs SET created_at = ${at.toISOString()}, completed_at = ${at.toISOString()} WHERE id = ${runId}`,
	);
}

export interface SeedRunOptions {
	db: Db;
	repo: { externalId: string; owner: string; name: string; fullName: string };
	actor: Contributor;
	number: number;
	title: string;
	verdict: Verdict;
	/** Rule refs that FAILED (drive the block/review). Others pass. */
	failed?: string[];
	/** When set, adds an ai-review step with these findings (the showcase). */
	aiReview?: { output: AiReviewOutput };
	at: Date;
}

/**
 * One shape-correct run + its event, steps and actions. `needs_review` pauses
 * the run and opens a pending moderation item (the queue is a paused run, §6).
 */
export async function seedRun(opts: SeedRunOptions): Promise<string> {
	const { db, repo, actor, number, verdict, at } = opts;
	const headSha = `demo${number.toString().padStart(6, "0")}`;
	const eventId = `demo-evt-${repo.name}-${number}`;
	const normalized = changeRequestEvent({
		eventId,
		repo,
		actor,
		number,
		title: opts.title,
		headSha,
		at,
	});
	await insertEvent(db, normalized);

	const useAi = Boolean(opts.aiReview);
	const snapshot = useAi ? [AI_REVIEW_WORKFLOW] : [DEFAULT_WORKFLOW];
	const runId = await runServices.createRun(db, {
		eventId,
		repoFullName: repo.fullName,
		subjectNumber: number,
		headSha,
		snapshot,
		status: verdict === "needs_review" ? "paused" : "completed",
		verdict,
	});

	const steps: runServices.RecordStepInput[] = [
		nonRuleStep({ nodeId: "trigger", nodeKind: "trigger", status: "pass", at }),
	];
	const failed = new Set(opts.failed ?? []);

	if (useAi && opts.aiReview) {
		const output = opts.aiReview.output;
		steps.push(
			ruleStep({
				nodeId: "ai",
				ref: "ai-review@2",
				passed: output.verdict === "pass",
				evidence: { output, trace: { steps: output.findings.length } },
				publicEvidence: { output },
				summary: output.summary,
				at,
			}),
		);
	} else {
		for (const node of DEFAULT_WORKFLOW.nodes) {
			if (node.type !== "rule") {
				continue;
			}
			const didFail = failed.has(node.ref);
			steps.push(
				ruleStep({
					nodeId: node.id,
					ref: node.ref,
					passed: !didFail,
					evidence: didFail
						? { matched: true, detail: `${node.ref} tripped` }
						: { matched: false },
					at,
				}),
			);
		}
	}

	const gateFailed = verdict !== "pass";
	steps.push(
		nonRuleStep({
			nodeId: "gate",
			nodeKind: "gate",
			status: gateFailed ? "fail" : "pass",
			at,
		}),
	);
	steps.push(
		nonRuleStep({
			nodeId: useAi ? "block" : "block",
			nodeKind: "action",
			status: gateFailed ? "pass" : "not-reached",
			at,
		}),
	);
	await runServices.recordSteps(db, runId, steps);

	// Actions: recorded first, then marked executed (the run's real discipline).
	const actionKinds =
		verdict === "block"
			? ["block", "comment", "set-check"]
			: verdict === "needs_review"
				? ["send-to-moderation", "comment", "set-check"]
				: ["comment", "set-check"];
	const rows = await runServices.recordActions(
		db,
		runId,
		actionKinds.map((kind) => ({
			kind,
			payload: {},
			idempotencyKey: `${kind}:${repo.fullName}#${number}`,
		})),
	);
	for (const row of rows) {
		await runServices.markActionExecuted(db, row.id, null);
	}

	if (verdict === "needs_review") {
		await moderationServices.createModerationItem(db, {
			runId,
			nodeId: "review",
		});
	}

	await backdateRun(db, runId, at);
	return runId;
}

const SPAMMER: Contributor = { login: "crypto-spammer", externalId: "1003" };
const DRIVEBY: Contributor = { login: "driveby-42", externalId: "1002" };
const NEWCOMER: Contributor = { login: "newcomer", externalId: "1004" };
const HONEST: Contributor = { login: "honest-dev", externalId: "1005" };

const AI_FINDINGS: Finding[] = [
	{
		severity: "critical",
		file: ".github/workflows/release.yml",
		line: 34,
		note: "exfiltrates `secrets.NPM_TOKEN` to an external host on every push.",
	},
	{
		severity: "warn",
		file: "src/config/loader.ts",
		line: 88,
		note: "widens `allowedHosts` to `*` — disables the origin check.",
	},
	{
		severity: "info",
		file: "src/config/loader.ts",
		note: "unrelated formatting churn mixed into a security-sensitive diff.",
	},
];

/**
 * Wipe one repo's seeded runs/events/moderation so re-seeding it is idempotent
 * WITHOUT touching other demo repos (a persona reseed must not nuke the rest).
 */
export async function resetRepoData(
	db: Db,
	repoFullName: string,
): Promise<void> {
	const repoRuns = sql`SELECT id FROM runs WHERE repo_full_name = ${repoFullName}`;
	await db.execute(
		sql`DELETE FROM moderation_items WHERE run_id IN (${repoRuns})`,
	);
	await db.execute(sql`DELETE FROM run_actions WHERE run_id IN (${repoRuns})`);
	await db.execute(sql`DELETE FROM run_steps WHERE run_id IN (${repoRuns})`);
	await db.execute(
		sql`DELETE FROM runs WHERE repo_full_name = ${repoFullName}`,
	);
	await db.execute(
		sql`DELETE FROM events WHERE repo_full_name = ${repoFullName} AND id LIKE ${"demo-evt-%"}`,
	);
}

/**
 * A full, presentable story for one repo (§13.10): change requests across
 * states, an ai-review block with findings across files, a pending moderation
 * item, activity, and populated rollups so the Home cards show real series.
 * Idempotent per-repo — safe to re-run for the same repo.
 */
export async function seedStory(
	db: Db,
	repo: { externalId: string; owner: string; name: string; fullName: string },
	now: Date,
): Promise<void> {
	await resetRepoData(db, repo.fullName);
	let n = 100;
	const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

	// Blocks — crypto / honeypot spray across the last day.
	await seedRun({
		db,
		repo,
		actor: SPAMMER,
		number: n++,
		title: "add donation address to README",
		verdict: "block",
		failed: ["crypto-address@1"],
		at: ago(1),
	});
	await seedRun({
		db,
		repo,
		actor: DRIVEBY,
		number: n++,
		title: "update CI workflow",
		verdict: "block",
		failed: ["honeypot@1", "account-age@1"],
		at: ago(6),
	});
	await seedRun({
		db,
		repo,
		actor: SPAMMER,
		number: n++,
		title: "chore: tidy deps",
		verdict: "block",
		failed: ["crypto-address@1"],
		at: ago(20),
	});

	// The ai-review showcase — a block with real findings across two files.
	await seedRun({
		db,
		repo,
		actor: DRIVEBY,
		number: n++,
		title: "perf: cache release artifacts",
		verdict: "block",
		aiReview: {
			output: {
				verdict: "block",
				confidence: 0.94,
				summary:
					"workflow change exfiltrates an npm token and disables the origin allowlist.",
				findings: AI_FINDINGS,
			},
		},
		at: ago(3),
	});

	// Passes — the honest contributors.
	for (const h of [2, 8, 12, 18]) {
		await seedRun({
			db,
			repo,
			actor: HONEST,
			number: n++,
			title: "fix: correct typo in docs",
			verdict: "pass",
			at: ago(h),
		});
	}

	// Sent to review — the pending queue item awaiting a maintainer's decision.
	await seedRun({
		db,
		repo,
		actor: NEWCOMER,
		number: n++,
		title: "feat: add locale files",
		verdict: "needs_review",
		failed: ["english-only@1"],
		at: ago(4),
	});

	// Rollups for the window the Home cards read.
	await insightServices.computeDailyRollups(db, isoDay(now));
	await insightServices.computeDailyRollups(db, isoDay(ago(24)));
}

/** A single public (non-private) run a stranger can read — persona 6. */
export async function seedPublicRun(
	db: Db,
	repo: { externalId: string; owner: string; name: string; fullName: string },
	now: Date,
): Promise<string> {
	await resetRepoData(db, repo.fullName);
	return await seedRun({
		db,
		repo,
		actor: SPAMMER,
		number: 7,
		title: "add wallet address to funding",
		verdict: "block",
		failed: ["crypto-address@1"],
		at: new Date(now.getTime() - 2 * HOUR),
	});
}

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** Ensure a demo repo exists (idempotent), returning its id + ref. */
export async function ensureDemoRepo(
	db: Db,
	name: string,
	opts: { private?: boolean; installationId?: string | null } = {},
): Promise<{
	id: string;
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
}> {
	const ref = demoRepoRef(name);
	const id = await repoServices.ensureRepo(db, {
		...ref,
		private: opts.private ?? false,
		installationId: opts.installationId ?? null,
	});
	return { id, ...ref };
}

/**
 * Wipe ONLY seeded rows — the `tripwire-demo/*` repos, their runs/steps/actions/
 * moderation/rollups/config, the `demo-*` events, and the `@tripwire.demo`
 * users (auth cascades their sessions/accounts/installations). Never touches a
 * real table's real rows.
 */
export async function resetDemoData(db: Db): Promise<void> {
	const demoRuns = sql`SELECT id FROM runs WHERE repo_full_name LIKE ${`${DEMO_OWNER}/%`}`;
	const demoRepos = sql`SELECT id FROM repos WHERE full_name LIKE ${`${DEMO_OWNER}/%`}`;
	await db.execute(
		sql`DELETE FROM moderation_items WHERE run_id IN (${demoRuns})`,
	);
	await db.execute(sql`DELETE FROM run_actions WHERE run_id IN (${demoRuns})`);
	await db.execute(sql`DELETE FROM run_steps WHERE run_id IN (${demoRuns})`);
	await db.execute(
		sql`DELETE FROM runs WHERE repo_full_name LIKE ${`${DEMO_OWNER}/%`}`,
	);
	await db.execute(
		sql`DELETE FROM rollups_daily WHERE repo_id IN (${demoRepos})`,
	);
	await db.execute(
		sql`DELETE FROM rule_configs WHERE repo_id IN (${demoRepos})`,
	);
	await db.execute(
		sql`DELETE FROM workflow_definitions WHERE repo_id IN (${demoRepos})`,
	);
	await db.execute(sql`DELETE FROM events WHERE id LIKE ${"demo-evt-%"}`);
	// Auth cascades sessions/accounts/forge_identities/user_installations.
	await db.execute(
		sql`DELETE FROM "user" WHERE email LIKE ${`%@${DEMO_EMAIL_DOMAIN}`}`,
	);
	await db.execute(
		sql`DELETE FROM repos WHERE full_name LIKE ${`${DEMO_OWNER}/%`}`,
	);
}
