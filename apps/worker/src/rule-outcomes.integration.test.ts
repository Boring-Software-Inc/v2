import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	moderationServices,
	repoServices,
	type TestDatabase,
} from "@tripwire/db";
import type { ForgeAction } from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { staticForge } from "./forge-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";
import { rerunChangeRequest } from "./jobs/rerun.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });
const DAY = 86_400_000;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

interface Scenario {
	ageDays?: number;
	files?: number;
	diffDown?: boolean;
	profileDown?: boolean;
	maintainer?: boolean | null;
	orgMember?: boolean | null;
}

function reads(scenario: Scenario) {
	return {
		getDiff: () =>
			scenario.diffDown
				? Promise.reject(new Error("diff down"))
				: Promise.resolve(
						Array.from({ length: scenario.files ?? 1 }, (_, index) => ({
							path: `src/file-${index}.ts`,
							status: "modified" as const,
							additions: 1,
							deletions: 0,
						})),
					),
		getCommits: () => Promise.resolve([]),
		getContributorProfile: () =>
			scenario.profileDown
				? Promise.reject(new Error("profile down"))
				: Promise.resolve({
						login: "Codertocat",
						externalId: "21031067",
						createdAt: new Date(
							Date.now() - (scenario.ageDays ?? 400) * DAY,
						).toISOString(),
						followers: 0,
						following: 0,
						publicRepos: 0,
						profileText: null,
						mergedInRepo: 0,
						mergedElsewhere: 0,
						recentChangeRequestTimes: [],
						isOrgMember:
							scenario.orgMember === undefined ? false : scenario.orgMember,
						isMaintainer:
							scenario.maintainer === undefined ? false : scenario.maintainer,
					}),
	};
}

function fakeAdapter() {
	const executed: ForgeAction[] = [];
	let reviews = 0;
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
			execute: (action: ForgeAction) => {
				executed.push(action);
				if (action.kind === "block") {
					reviews++;
					return Promise.resolve({ externalId: `rev-${reviews}` });
				}
				if (
					action.kind === "update-review" ||
					action.kind === "dismiss-review"
				) {
					return Promise.resolve({ externalId: action.reviewId });
				}
				return Promise.resolve({ externalId: `ext-${executed.length}` });
			},
		},
	};
}

let repoCounter = 0;

async function freshRepo(): Promise<{
	repoId: string;
	fullName: string;
	externalId: number;
}> {
	repoCounter++;
	const name = `outcomes-${repoCounter}`;
	const externalId = 900_000 + repoCounter;
	const repoId = await repoServices.ensureRepo(db, {
		externalId: String(externalId),
		owner: "Codertocat",
		name,
		fullName: `Codertocat/${name}`,
	});
	await repoServices.setRepoArmed(db, repoId, true);
	return { repoId, fullName: `Codertocat/${name}`, externalId };
}

async function enableRule(
	repoId: string,
	ruleId: string,
	config: Parameters<typeof repoServices.upsertRuleConfig>[2]["config"],
) {
	await repoServices.upsertRuleConfig(db, repoId, {
		ruleId,
		version: 1,
		enabled: true,
		config,
	});
}

async function failWith(
	repoId: string,
	ruleId: string,
	config: Record<string, string | number>,
	action: "request-fix" | "note" | "send-to-moderation" | "close",
	message?: string,
) {
	await repoServices.saveWorkflowDefinition(
		db,
		repoId,
		workflow(
			`${ruleId}-on-fail`,
			[
				{ id: "rule", type: "rule", ref: `${ruleId}@1`, config },
				message
					? { id: "outcome", type: "action", action, params: { message } }
					: { id: "outcome", type: "action", action },
			],
			[
				{ id: "e1", from: "t", to: "rule" },
				{ id: "e2", from: "rule", to: "outcome", when: "fail" },
			],
		),
	);
}

let delivery = 0;

async function insertPrEvent(
	repo: { fullName: string; externalId: number },
	options: { sha?: string; action?: string; number?: number } = {},
): Promise<string> {
	const raw = await Bun.file(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.opened.json",
			import.meta.url,
		).pathname,
	).json();
	const [owner, name] = repo.fullName.split("/");
	raw.action = options.action ?? "opened";
	raw.repository.full_name = repo.fullName;
	raw.repository.name = name;
	raw.repository.owner.login = owner;
	raw.repository.id = repo.externalId;
	raw.number = options.number ?? 2;
	raw.pull_request.number = options.number ?? 2;
	raw.pull_request.head.sha = options.sha ?? "a".repeat(40);
	delivery++;
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId: `outcomes-${delivery}`,
		rawKind: "pull_request",
		raw,
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
	return eventId;
}

async function processPrEvent(eventId: string, scenario: Scenario) {
	const fake = fakeAdapter();
	const resolveForge = staticForge({
		reads: reads(scenario),
		adapter: fake.adapter as never,
	});
	await processEvent(
		{
			db,
			pool,
			logger,
			resolveForge,
			makeGenerate: null,
			appUrl: "https://tripwire.sh",
		},
		{ eventId },
	);
	const run = await pool.query(
		"SELECT id, status, verdict FROM runs WHERE event_id = $1",
		[eventId],
	);
	return {
		run: run.rows[0] as
			| { id: string; status: string; verdict: string }
			| undefined,
		executed: fake.executed,
		resolveForge,
		fake,
	};
}

async function openPr(
	repo: { fullName: string; externalId: number },
	scenario: Scenario,
	options: { sha?: string; action?: string; number?: number } = {},
) {
	return processPrEvent(await insertPrEvent(repo, options), scenario);
}

function kinds(executed: ForgeAction[]): string[] {
	return executed.map((action) => action.kind);
}

function commentBody(executed: ForgeAction[]): string {
	const comment = executed.find((action) => action.kind === "comment");
	return comment && comment.kind === "comment" ? comment.body : "";
}

function checkOf(executed: ForgeAction[]) {
	const check = [...executed]
		.reverse()
		.find((action) => action.kind === "set-check");
	return check && check.kind === "set-check" ? check.check : null;
}

async function decide(
	runId: string,
	nodeId: string,
	decision: "approve" | "deny",
	scenario: Scenario,
) {
	const items = await moderationServices.listModerationItemsForRun(db, runId);
	const item = items.find(
		(candidate) =>
			candidate.nodeId === nodeId && candidate.status === "pending",
	);
	if (!item) {
		throw new Error(`no pending item ${nodeId}`);
	}
	await moderationServices.decideModerationItem(pool, boss, {
		itemId: item.id,
		decision,
		decidedBy: null,
	});
	const fake = fakeAdapter();
	await resumeRun(
		{
			db,
			pool,
			logger,
			resolveForge: staticForge({
				reads: reads(scenario),
				adapter: fake.adapter as never,
			}),
			makeGenerate: null,
			appUrl: "https://tripwire.sh",
		},
		{ itemId: item.id, decision },
	);
	const run = await pool.query(
		"SELECT status, verdict FROM runs WHERE id = $1",
		[runId],
	);
	return { run: run.rows[0] as { status: string; verdict: string }, fake };
}

const YOUNG = { ageDays: 2 };

describe("rule outcomes", () => {
	test.each([
		{ maintainer: null, orgMember: null },
		{ maintainer: null, orgMember: false },
		{ maintainer: false, orgMember: null },
	])("unknown membership never exempts the author: %j", async (membership) => {
		const repo = await freshRepo();
		await enableRule(repo.repoId, "account-age", { minDays: 7 });
		const { run, executed } = await openPr(repo, { ...YOUNG, ...membership });
		expect(run?.verdict).toBe("block");
		expect(kinds(executed)).toContain("block");
	});

	test.each([
		{ maintainer: true, orgMember: null },
		{ maintainer: null, orgMember: true },
	])("confirmed membership still exempts the author: %j", async (membership) => {
		const repo = await freshRepo();
		await enableRule(repo.repoId, "account-age", { minDays: 7 });
		const { run, executed } = await openPr(repo, { ...YOUNG, ...membership });
		expect(run).toBeUndefined();
		expect(kinds(executed)).not.toContain("block");
	});

	test("an installed rule blocks: red check, one changes-requested review", async () => {
		const repo = await freshRepo();
		await enableRule(repo.repoId, "account-age", { minDays: 7 });
		const { run, executed } = await openPr(repo, YOUNG);
		expect(run?.verdict).toBe("block");
		expect(kinds(executed)).toContain("block");
		expect(checkOf(executed)?.conclusion).toBe("failure");
	});

	test("Ask author to fix: red check, the instruction, no GitHub review", async () => {
		const repo = await freshRepo();
		await failWith(
			repo.repoId,
			"account-age",
			{ minDays: 7 },
			"request-fix",
			"Change the target to main.",
		);
		const { run, executed } = await openPr(repo, YOUNG);
		expect(run?.verdict).toBe("changes_required");
		expect(run?.status).toBe("completed");
		expect(kinds(executed)).not.toContain("block");
		expect(checkOf(executed)?.conclusion).toBe("failure");
		expect(checkOf(executed)?.summary).toBe(
			"Changes needed. Change the target to main.",
		);
		expect(commentBody(executed)).toContain(
			"Changes needed. Change the target to main.",
		);
	});

	test("Note only: green check and a factual note", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "note");
		const { run, executed } = await openPr(repo, YOUNG);
		expect(run?.verdict).toBe("pass");
		expect(checkOf(executed)?.conclusion).toBe("success");
		expect(commentBody(executed)).toContain(
			"Tripwire passed this change request. No description provided.",
		);
		expect(kinds(executed)).not.toContain("block");
	});

	test("Note only respects the comment setting", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "note");
		await repoServices.upsertResponseConfig(db, repo.repoId, {
			...(await repoServices.getResponseConfig(db, repo.repoId)),
			onNote: "silent",
		});
		const { run, executed } = await openPr(repo, YOUNG);
		expect(run?.verdict).toBe("pass");
		expect(kinds(executed)).not.toContain("comment");
	});

	test("Human review pauses the run", async () => {
		const repo = await freshRepo();
		await failWith(
			repo.repoId,
			"account-age",
			{ minDays: 7 },
			"send-to-moderation",
		);
		const { run } = await openPr(repo, YOUNG);
		expect(run?.verdict).toBe("needs_review");
		expect(run?.status).toBe("paused");
	});

	test("clearing a block into an empty silent fix request deletes the stale comment", async () => {
		const repo = await freshRepo();
		await enableRule(repo.repoId, "account-age", { minDays: 7 });
		await failWith(repo.repoId, "max-files-changed", { max: 1 }, "request-fix");
		const first = await openPr(repo, { ...YOUNG, files: 2 });
		expect(first.run?.verdict).toBe("block");
		expect(kinds(first.executed)).toContain("comment");
		await repoServices.upsertResponseConfig(db, repo.repoId, {
			...(await repoServices.getResponseConfig(db, repo.repoId)),
			onChangesRequired: "silent",
			blocks: { changes_required: [] },
		});
		const { run, executed } = await openPr(
			repo,
			{ ageDays: 30, files: 2 },
			{
				sha: "c".repeat(40),
				action: "synchronize",
			},
		);
		expect(run?.verdict).toBe("changes_required");
		expect(kinds(executed)).not.toContain("comment");
		expect(kinds(executed)).toContain("delete-comment");
		expect(kinds(executed)).toContain("dismiss-review");
	});
});

describe("Close outcome", () => {
	test("an empty close comment deletes the old comment and still closes", async () => {
		const repo = await freshRepo();
		await enableRule(repo.repoId, "account-age", { minDays: 7 });
		const first = await openPr(repo, YOUNG, { sha: "b".repeat(40) });
		expect(kinds(first.executed)).toContain("comment");
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		await repoServices.upsertResponseConfig(db, repo.repoId, {
			...(await repoServices.getResponseConfig(db, repo.repoId)),
			blocks: { close: [] },
		});
		const { run, executed } = await openPr(repo, YOUNG, {
			sha: "c".repeat(40),
			action: "synchronize",
		});
		expect(run?.verdict).toBe("close");
		const order = kinds(executed);
		expect(order).not.toContain("comment");
		expect(order).toContain("delete-comment");
		expect(order).toContain("dismiss-review");
		expect(order.at(-1)).toBe("close");
		expect(checkOf(executed)?.conclusion).toBe("failure");
	});

	test("comment with the reason, red check, then close; no review", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const { run, executed } = await openPr(repo, YOUNG);
		expect(run?.verdict).toBe("close");
		const order = kinds(executed);
		expect(order).not.toContain("block");
		expect(order.at(-1)).toBe("close");
		expect(order.indexOf("comment")).toBeLessThan(order.indexOf("close"));
		expect(order.indexOf("set-check")).toBeLessThan(order.indexOf("close"));
		expect(checkOf(executed)?.conclusion).toBe("failure");
		expect(commentBody(executed)).toContain("Closed.");
		expect(commentBody(executed)).toContain("Account age");
	});

	test("close dismisses Tripwire's earlier review and never reopens", async () => {
		const repo = await freshRepo();
		await enableRule(repo.repoId, "account-age", { minDays: 7 });
		const first = await openPr(repo, YOUNG, { sha: "b".repeat(40) });
		expect(first.run?.verdict).toBe("block");
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const second = await openPr(repo, YOUNG, {
			sha: "c".repeat(40),
			action: "synchronize",
		});
		expect(second.run?.verdict).toBe("close");
		const order = kinds(second.executed);
		expect(order).toContain("dismiss-review");
		expect(order).not.toContain("block");
		expect(order).not.toContain("update-review");
		expect(order.at(-1)).toBe("close");
		expect(order.some((kind) => kind.includes("reopen"))).toBe(false);
	});

	test("a human reopen on the same head is not closed again", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const sha = "d".repeat(40);
		const first = await openPr(repo, YOUNG, { sha });
		expect(kinds(first.executed)).toContain("close");
		const reopened = await openPr(repo, YOUNG, { sha, action: "reopened" });
		expect(reopened.run?.verdict).toBe("block");
		expect(kinds(reopened.executed)).not.toContain("close");
		const held = await pool.query(
			"SELECT input FROM run_steps WHERE run_id = $1 AND node_id = 'run:close-held'",
			[reopened.run?.id],
		);
		expect(held.rows[0]?.input).toEqual({ action: "close", hold: "reopened" });

		const pushed = await openPr(repo, YOUNG, {
			sha: "e".repeat(40),
			action: "synchronize",
		});
		expect(pushed.run?.verdict).toBe("close");
		expect(kinds(pushed.executed)).toContain("close");
	});

	test("never closes on a degraded run", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "max-files-changed", { max: 1 }, "close");
		await enableRule(repo.repoId, "account-age", { minDays: 7 });
		const { run, executed } = await openPr(repo, {
			files: 5,
			profileDown: true,
		});
		expect(kinds(executed)).not.toContain("close");
		expect(run?.verdict).toBe("needs_review");
		const held = await pool.query(
			"SELECT input FROM run_steps WHERE run_id = $1 AND node_id = 'run:close-held'",
			[run?.id],
		);
		expect(held.rows[0]?.input).toEqual({ action: "close", hold: "degraded" });
	});

	test("never closes for an exempt contributor", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const { run, executed } = await openPr(repo, {
			...YOUNG,
			maintainer: true,
		});
		expect(run).toBeUndefined();
		expect(kinds(executed)).not.toContain("close");
	});

	test("close outranks block in the join", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		await enableRule(repo.repoId, "max-files-changed", { max: 1 });
		const { run, executed } = await openPr(repo, { ...YOUNG, files: 5 });
		expect(run?.verdict).toBe("close");
		expect(kinds(executed)).not.toContain("block");
		expect(commentBody(executed)).toContain("Max files changed");
	});
});

function workflow(
	id: string,
	nodes: WorkflowDefinition["nodes"],
	edges: WorkflowDefinition["edges"],
): WorkflowDefinition {
	return {
		id,
		name: id,
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: ["change-request.opened", "change-request.updated"],
			},
			...nodes,
		],
		edges,
	};
}

const AGE_FIX = workflow(
	"age-fix",
	[
		{
			id: "age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
		},
		{
			id: "fix",
			type: "action",
			action: "request-fix",
			params: { message: "Change the target to main." },
		},
	],
	[
		{ id: "e1", from: "t", to: "age" },
		{ id: "e2", from: "age", to: "fix", when: "fail" },
	],
);

const AGE_BLOCK = workflow(
	"age-block",
	[
		{
			id: "age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
		},
		{ id: "block", type: "action", action: "block" },
	],
	[
		{ id: "e1", from: "t", to: "age" },
		{ id: "e2", from: "age", to: "block", when: "fail" },
	],
);

const FILES_REVIEW = workflow(
	"files-review",
	[
		{
			id: "files",
			type: "rule",
			ref: "max-files-changed@1",
			config: { max: 1 },
		},
		{ id: "review", type: "action", action: "send-to-moderation" },
	],
	[
		{ id: "e1", from: "t", to: "files" },
		{ id: "e2", from: "files", to: "review", when: "fail" },
	],
);

const EXCEPT_WHEN = workflow(
	"except-when",
	[
		{
			id: "age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
		},
		{
			id: "files",
			type: "rule",
			ref: "max-files-changed@1",
			config: { max: 1 },
		},
		{ id: "unless", type: "gate", mode: "unless" },
		{
			id: "fix",
			type: "action",
			action: "request-fix",
			params: { message: "Change the target to main." },
		},
	],
	[
		{ id: "e1", from: "t", to: "age" },
		{ id: "e2", from: "t", to: "files" },
		{ id: "e3", from: "age", to: "unless", input: "requirement" },
		{ id: "e4", from: "files", to: "unless", input: "exception" },
		{ id: "e5", from: "unless", to: "fix", when: "fail" },
	],
);

async function withWorkflows(...definitions: WorkflowDefinition[]) {
	const repo = await freshRepo();
	for (const definition of definitions) {
		await repoServices.saveWorkflowDefinition(db, repo.repoId, definition);
	}
	return repo;
}

describe("workflow outcomes", () => {
	test("fix plus review: changes needed headline, review pending appended", async () => {
		const repo = await withWorkflows(AGE_FIX, FILES_REVIEW);
		const scenario = { ...YOUNG, files: 5 };
		const { run, executed } = await openPr(repo, scenario);
		expect(run?.verdict).toBe("changes_required");
		expect(run?.status).toBe("paused");
		expect(commentBody(executed)).toContain(
			"Changes needed. Change the target to main. Waiting for review.",
		);
		expect(kinds(executed)).not.toContain("block");

		const approved = await decide(
			run?.id ?? "",
			"files-review:review",
			"approve",
			scenario,
		);
		expect(approved.run).toEqual({
			status: "completed",
			verdict: "changes_required",
		});
		expect(commentBody(approved.fake.executed)).toContain(
			"Changes needed. Change the target to main.",
		);
		expect(commentBody(approved.fake.executed)).not.toContain(
			"Waiting for review.",
		);
	});

	test("approval clears only its own item while another block stays active", async () => {
		const repo = await withWorkflows(AGE_BLOCK, FILES_REVIEW);
		const scenario = { ...YOUNG, files: 5 };
		const { run } = await openPr(repo, scenario);
		expect(run?.verdict).toBe("block");
		expect(run?.status).toBe("paused");
		const approved = await decide(
			run?.id ?? "",
			"files-review:review",
			"approve",
			scenario,
		);
		expect(approved.run).toEqual({ status: "completed", verdict: "block" });
	});

	test("an independent check keeps running while a human review waits", async () => {
		const single = workflow(
			"single",
			[
				...FILES_REVIEW.nodes.slice(1),
				{
					id: "age",
					type: "rule",
					ref: "account-age@1",
					config: { minDays: 7 },
				},
				{ id: "block", type: "action", action: "block" },
			],
			[
				...FILES_REVIEW.edges,
				{ id: "e3", from: "t", to: "age" },
				{ id: "e4", from: "age", to: "block", when: "fail" },
			],
		);
		const repo = await withWorkflows(single);
		const { run, executed } = await openPr(repo, { ...YOUNG, files: 5 });
		expect(run?.verdict).toBe("block");
		expect(run?.status).toBe("paused");
		expect(kinds(executed)).toContain("block");
	});

	test("the same rule in separate workflows keeps every active issue", async () => {
		const repo = await withWorkflows(AGE_FIX, AGE_BLOCK);
		const { run, executed } = await openPr(repo, YOUNG);
		expect(run?.verdict).toBe("block");
		const body = commentBody(executed);
		expect(body).toContain("Account age");
		expect(body).toContain("Changes needed. Change the target to main.");
	});

	test("when the last block clears, Tripwire's review is dismissed even though a fix remains", async () => {
		const repo = await withWorkflows(AGE_FIX, FILES_REVIEW);
		await pool.query(
			"UPDATE workflow_definitions SET enabled = false WHERE repo_id = $1 AND name = 'files-review'",
			[repo.repoId],
		);
		await repoServices.saveWorkflowDefinition(db, repo.repoId, {
			...workflow(
				"files-block",
				[
					{
						id: "files",
						type: "rule",
						ref: "max-files-changed@1",
						config: { max: 1 },
					},
					{ id: "block", type: "action", action: "block" },
				],
				[
					{ id: "e1", from: "t", to: "files" },
					{ id: "e2", from: "files", to: "block", when: "fail" },
				],
			),
		});
		const blocked = await openPr(
			repo,
			{ ...YOUNG, files: 5 },
			{ sha: "f".repeat(40) },
		);
		expect(blocked.run?.verdict).toBe("block");
		expect(kinds(blocked.executed)).toContain("block");
		const fixed = await openPr(
			repo,
			{ ...YOUNG, files: 1 },
			{ sha: "1".repeat(40), action: "synchronize" },
		);
		expect(fixed.run?.verdict).toBe("changes_required");
		expect(kinds(fixed.executed)).toContain("dismiss-review");
		expect(kinds(fixed.executed)).not.toContain("block");
	});
});

describe("Except when", () => {
	test("the exception waives a failed requirement and the run records it", async () => {
		const repo = await withWorkflows(EXCEPT_WHEN);
		const { run } = await openPr(repo, { ...YOUNG, files: 1 });
		expect(run?.verdict).toBe("pass");
		const gate = await pool.query(
			"SELECT output FROM run_steps WHERE run_id = $1 AND node_id = 'except-when:unless'",
			[run?.id],
		);
		expect(gate.rows[0]?.output).toMatchObject({
			outcome: "pass",
			requirement: "fail",
			exception: "pass",
			exceptionApplied: true,
		});
	});

	test("missing exception proof does not waive the requirement", async () => {
		const repo = await withWorkflows(EXCEPT_WHEN);
		const { run, executed } = await openPr(repo, {
			...YOUNG,
			diffDown: true,
		});
		expect(run?.verdict).toBe("changes_required");
		expect(commentBody(executed)).toContain("Changes needed.");
	});

	test("an unused exception check that cannot run creates no hold", async () => {
		const repo = await withWorkflows(EXCEPT_WHEN);
		const { run } = await openPr(repo, { ageDays: 400, diffDown: true });
		expect(run?.verdict).toBe("pass");
		expect(run?.status).toBe("completed");
	});
});

describe("retries and stale runs", () => {
	test("a retried fix request never becomes a review, and a stale close never closes", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const stale = await openPr(repo, YOUNG, { sha: "7".repeat(40) });
		await failWith(
			repo.repoId,
			"account-age",
			{ minDays: 7 },
			"request-fix",
			"Change the target to main.",
		);
		const latest = await openPr(repo, YOUNG, {
			sha: "8".repeat(40),
			action: "synchronize",
		});
		expect(latest.run?.verdict).toBe("changes_required");
		await pool.query(
			"UPDATE run_actions SET status = 'recorded', executed_at = NULL WHERE (run_id = $1 AND kind = 'close') OR (run_id = $2 AND kind = 'request-fix')",
			[stale.run?.id, latest.run?.id],
		);
		const fake = fakeAdapter();
		await sweepActions(
			{
				db,
				adapterFor: () => Promise.resolve(fake.adapter as never),
				logger,
				appUrl: "https://tripwire.sh",
			},
			{
				recordedBefore: new Date(Date.now() + 60_000),
				giveUpBefore: new Date(0),
			},
		);
		expect(kinds(fake.executed)).not.toContain("block");
		expect(kinds(fake.executed)).not.toContain("close");
		const rows = await pool.query(
			"SELECT kind, status FROM run_actions WHERE (run_id = $1 AND kind = 'close') OR (run_id = $2 AND kind = 'request-fix') ORDER BY kind",
			[stale.run?.id, latest.run?.id],
		);
		expect(rows.rows).toEqual([
			{ kind: "close", status: "superseded" },
			{ kind: "request-fix", status: "executed" },
		]);
	});
});

describe("review findings", () => {
	const AGE_REVIEW = workflow(
		"age-review",
		[
			{
				id: "age",
				type: "rule",
				ref: "account-age@1",
				config: { minDays: 7 },
			},
			{ id: "review", type: "action", action: "send-to-moderation" },
		],
		[
			{ id: "e1", from: "t", to: "age" },
			{ id: "e2", from: "age", to: "review", when: "fail" },
		],
	);

	test("two decisions queued before either resume both apply", async () => {
		const repo = await withWorkflows(AGE_REVIEW, FILES_REVIEW);
		const scenario = { ...YOUNG, files: 5 };
		const { run } = await openPr(repo, scenario);
		const runId = run?.id ?? "";
		expect(run?.status).toBe("paused");
		const items = await moderationServices.listModerationItemsForRun(db, runId);
		const byNode = new Map(items.map((item) => [item.nodeId, item]));
		const approveItem = byNode.get("age-review:review");
		const denyItem = byNode.get("files-review:review");
		if (!(approveItem && denyItem)) {
			throw new Error("expected two review items");
		}
		await moderationServices.decideModerationItem(pool, boss, {
			itemId: approveItem.id,
			decision: "approve",
			decidedBy: null,
		});
		await moderationServices.decideModerationItem(pool, boss, {
			itemId: denyItem.id,
			decision: "deny",
			decidedBy: null,
		});
		const resumeDeps = {
			db,
			pool,
			logger,
			resolveForge: staticForge({
				reads: reads(scenario),
				adapter: fakeAdapter().adapter as never,
			}),
			makeGenerate: null,
			appUrl: "https://tripwire.sh",
		};
		await resumeRun(resumeDeps, {
			itemId: approveItem.id,
			decision: "approve",
		});
		const between = await pool.query("SELECT status FROM runs WHERE id = $1", [
			runId,
		]);
		expect(between.rows[0]?.status).toBe("paused");
		await resumeRun(resumeDeps, { itemId: denyItem.id, decision: "deny" });
		const after = await pool.query(
			"SELECT status, verdict FROM runs WHERE id = $1",
			[runId],
		);
		expect(after.rows[0]).toEqual({ status: "completed", verdict: "block" });
	});

	test("closing the change request keeps the Close result while a review waited", async () => {
		const repo = await withWorkflows(FILES_REVIEW);
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const { run } = await openPr(repo, { ...YOUNG, files: 5 });
		expect(run).toMatchObject({ status: "paused", verdict: "close" });
		const closed = await moderationServices.closeReviewsForChangeRequest(
			db,
			"https://tripwire.sh",
			{ forge: "github", fullName: repo.fullName },
			2,
		);
		expect(closed).toEqual([]);
		const after = await pool.query(
			"SELECT status, verdict FROM runs WHERE id = $1",
			[run?.id],
		);
		expect(after.rows[0]).toEqual({ status: "completed", verdict: "close" });
		const items = await moderationServices.listModerationItemsForRun(
			db,
			run?.id ?? "",
		);
		expect(items.map((item) => item.status)).toEqual(["closed"]);
	});

	test("close waits until its comment and check have posted", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const raw = await Bun.file(
			new URL(
				"../../../packages/forge-github/fixtures/pull_request.opened.json",
				import.meta.url,
			).pathname,
		).json();
		const [owner, name] = repo.fullName.split("/");
		raw.repository.full_name = repo.fullName;
		raw.repository.name = name;
		raw.repository.owner.login = owner;
		raw.repository.id = repo.externalId;
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "outcomes-close-waits",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		const flaky = fakeAdapter();
		const execute = flaky.adapter.execute;
		flaky.adapter.execute = (action: ForgeAction) =>
			action.kind === "comment"
				? Promise.reject(new Error("comment down"))
				: execute(action);
		await processEvent(
			{
				db,
				pool,
				logger,
				resolveForge: staticForge({
					reads: reads(YOUNG),
					adapter: flaky.adapter as never,
				}),
				makeGenerate: null,
				appUrl: "https://tripwire.sh",
			},
			{ eventId },
		);
		expect(kinds(flaky.executed)).not.toContain("close");

		const healthy = fakeAdapter();
		const sweep = () =>
			sweepActions(
				{
					db,
					adapterFor: () => Promise.resolve(healthy.adapter as never),
					logger,
					appUrl: "https://tripwire.sh",
				},
				{
					recordedBefore: new Date(Date.now() + 60_000),
					giveUpBefore: new Date(0),
				},
			);
		await sweep();
		await sweep();
		const order = kinds(healthy.executed);
		expect(order).toContain("close");
		expect(order.indexOf("comment")).toBeLessThan(order.indexOf("close"));
	});
});

describe("a closed change request", () => {
	test("a manual re-run records the result and takes no PR action; a human reopen blocks", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const sha = "9".repeat(40);
		const first = await openPr(repo, YOUNG, { sha });
		expect(kinds(first.executed)).toContain("close");
		const closedEvent = await openPr(repo, YOUNG, { sha, action: "closed" });
		expect(closedEvent.run).toBeUndefined();

		const fake = fakeAdapter();
		await rerunChangeRequest(
			{
				db,
				pool,
				logger,
				resolveForge: staticForge({
					reads: reads(YOUNG),
					adapter: fake.adapter as never,
				}),
				makeGenerate: null,
				appUrl: "https://tripwire.sh",
			},
			{
				forge: "github",
				repoFullName: repo.fullName,
				number: 2,
				requestedBy: "admin-1",
			},
		);
		expect(fake.executed).toEqual([]);
		const rerun = await pool.query(
			"SELECT id, status, verdict FROM runs WHERE repo_full_name = $1 AND triggered_by = 'admin-1'",
			[repo.fullName],
		);
		expect(rerun.rows[0]).toMatchObject({
			status: "completed",
			verdict: "close",
		});
		const actions = await pool.query(
			"SELECT kind, status FROM run_actions WHERE run_id = $1",
			[rerun.rows[0]?.id],
		);
		expect(actions.rows).toEqual([{ kind: "close", status: "suppressed" }]);
		const step = await pool.query(
			"SELECT node_id FROM run_steps WHERE run_id = $1 AND node_id = 'run:change-request-closed'",
			[rerun.rows[0]?.id],
		);
		expect(step.rowCount).toBe(1);

		const reopened = await openPr(repo, YOUNG, { sha, action: "reopened" });
		expect(reopened.run?.verdict).toBe("block");
		expect(kinds(reopened.executed)).not.toContain("close");
	});
});

describe("ownership with #102 ordering", () => {
	test("an older event processed late never closes, comments or asks for a fix", async () => {
		const repo = await freshRepo();
		await failWith(repo.repoId, "account-age", { minDays: 7 }, "close");
		const olderEvent = await insertPrEvent(repo, { sha: "4".repeat(40) });
		const newerEvent = await insertPrEvent(repo, {
			sha: "5".repeat(40),
			action: "synchronize",
		});
		const newer = await processPrEvent(newerEvent, { ageDays: 400 });
		expect(newer.run?.verdict).toBe("pass");
		const older = await processPrEvent(olderEvent, YOUNG);
		expect(older.run?.verdict).toBe("close");
		expect(kinds(older.executed)).not.toContain("close");
		expect(kinds(older.executed)).not.toContain("comment");
		const rows = await pool.query(
			"SELECT kind, status FROM run_actions WHERE run_id = $1 AND kind IN ('close', 'comment') ORDER BY kind",
			[older.run?.id],
		);
		expect(rows.rows.map((row) => row.status)).toEqual([
			"superseded",
			"superseded",
		]);
	});

	test("approving a review on an older run leaves the newer run's surfaces alone", async () => {
		const repo = await withWorkflows(AGE_FIX, FILES_REVIEW);
		const scenario = { ...YOUNG, files: 5 };
		const older = await openPr(repo, scenario, { sha: "6".repeat(40) });
		expect(older.run?.status).toBe("paused");
		const newer = await openPr(
			repo,
			{ ageDays: 400, files: 1 },
			{ sha: "c".repeat(40), action: "synchronize" },
		);
		expect(newer.run?.verdict).toBe("pass");
		const approved = await decide(
			older.run?.id ?? "",
			"files-review:review",
			"approve",
			scenario,
		);
		expect(approved.run.verdict).toBe("changes_required");
		const touched = approved.fake.executed.filter(
			(action) =>
				action.kind === "comment" ||
				action.kind === "block" ||
				action.kind === "dismiss-review" ||
				action.kind === "close",
		);
		expect(touched).toEqual([]);
		const checks = approved.fake.executed.flatMap((action) =>
			action.kind === "set-check" ? [action.check.sha] : [],
		);
		expect(checks.every((sha) => sha === "6".repeat(40))).toBe(true);
	});
});
