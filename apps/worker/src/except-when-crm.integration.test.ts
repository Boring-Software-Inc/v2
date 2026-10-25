import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
	CustomRuleDefinition,
	WorkflowDefinition,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	customRuleServices,
	type Db,
	eventServices,
	repoServices,
	ruleServices,
	type TestDatabase,
	workflowServices,
} from "@tripwire/db";
import type { ForgeAction } from "@tripwire/forge";
import { GithubHttp } from "@tripwire/forge-github";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { staticForge } from "./forge-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });
const RELEASE_ACCOUNT = "release-bot";
const ETH = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

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

interface Pr {
	target: string;
	source: string;
	author: string;
	title?: string;
	sha?: string;
	action?: string;
	retargetedFrom?: string;
}

const offline = new GithubHttp({
	tokenFor: () => Promise.resolve("offline"),
	appId: 1,
	fetchImpl: ((_input: string | URL | Request) =>
		Promise.reject(new Error("offline"))) as typeof fetch,
});

function reads(pr: Pr) {
	return {
		getDiff: () =>
			Promise.resolve([
				{
					path: "src/index.ts",
					status: "modified" as const,
					additions: 1,
					deletions: 0,
				},
			]),
		getCommits: () => Promise.resolve([]),
		getContributorProfile: () =>
			Promise.resolve({
				login: pr.author,
				externalId: "21031067",
				createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
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
}

function fakeAdapter() {
	const executed: ForgeAction[] = [];
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
let delivery = 0;

async function crmRepo() {
	repoCounter++;
	const name = `crm-${repoCounter}`;
	const externalId = 950_000 + repoCounter;
	const repoId = await repoServices.ensureRepo(db, {
		externalId: String(externalId),
		owner: "trycompai",
		name,
		fullName: `trycompai/${name}`,
	});
	await repoServices.setRepoArmed(db, repoId, true);
	return { repoId, fullName: `trycompai/${name}`, externalId };
}

async function openPr(
	repo: { fullName: string; externalId: number },
	pr: Pr,
	number = 7,
) {
	const raw = await Bun.file(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.opened.json",
			import.meta.url,
		).pathname,
	).json();
	const [owner, name] = repo.fullName.split("/");
	raw.action = pr.action ?? "opened";
	raw.repository.full_name = repo.fullName;
	raw.repository.name = name;
	raw.repository.owner.login = owner;
	raw.repository.id = repo.externalId;
	raw.number = number;
	raw.pull_request.number = number;
	raw.pull_request.head.sha = pr.sha ?? "a".repeat(40);
	raw.pull_request.base.ref = pr.target;
	raw.pull_request.head.ref = pr.source;
	raw.pull_request.user.login = pr.author;
	raw.sender.login = pr.author;
	raw.pull_request.title = pr.title ?? "chore: release 1.2.0";
	if (pr.retargetedFrom) {
		raw.changes = {
			base: { ref: { from: pr.retargetedFrom }, sha: { from: "b".repeat(40) } },
		};
	}
	delivery++;
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId: `crm-${delivery}`,
		rawKind: "pull_request",
		raw,
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
	const fake = fakeAdapter();
	await processEvent(
		{
			db,
			pool,
			logger,
			resolveForge: staticForge({
				reads: reads(pr),
				adapter: fake.adapter as never,
				signalHttp: offline,
			}),
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
		run: run.rows[0] as { id: string; status: string; verdict: string },
		executed: fake.executed,
	};
}

function commentBody(executed: ForgeAction[]): string {
	const comment = executed.find((action) => action.kind === "comment");
	return comment && comment.kind === "comment" ? comment.body : "";
}

async function customRule(
	repoId: string,
	name: string,
	definition: CustomRuleDefinition,
	enabled = false,
): Promise<string> {
	const saved = await customRuleServices.saveCustomRule(db, {
		repoId,
		name,
		enabled,
		definition,
	});
	if (!saved.ok) {
		throw new Error(`custom rule ${name} did not save: ${saved.error}`);
	}
	return saved.rule.id;
}

async function ruleView(repoId: string, ruleId: string) {
	const views = await ruleServices.listRuleViews(db, repoId);
	const view = views.find((entry) => entry.ruleId === ruleId);
	if (!view) {
		throw new Error(`no view for ${ruleId}`);
	}
	return view;
}

function crmWorkflow(
	targetMain: string,
	exceptionRules: readonly string[],
): WorkflowDefinition {
	return {
		id: "crm",
		name: "Target is main",
		version: 1,
		nodes: [
			{
				id: "trigger",
				type: "trigger",
				kinds: ["change-request.opened", "change-request.updated"],
			},
			{
				id: "requirement",
				type: "rule",
				ref: `${targetMain}@1`,
				config: {},
			},
			{ id: "except-when", type: "gate", mode: "unless" },
			{ id: "exception", type: "gate", mode: "all-of" },
			{
				id: "outcome",
				type: "action",
				action: "request-fix",
				params: { message: "Change the target to main." },
			},
			...exceptionRules.map((ruleId) => ({
				id: ruleId,
				type: "rule" as const,
				ref: `${ruleId}@1`,
				config: {},
			})),
			{ id: "crypto", type: "rule", ref: "crypto-address@1", config: {} },
			{ id: "crypto-block", type: "action", action: "block" },
		],
		edges: [
			{ id: "trigger-requirement", from: "trigger", to: "requirement" },
			{
				id: "requirement-gate",
				from: "requirement",
				to: "except-when",
				input: "requirement",
			},
			{
				id: "exception-gate",
				from: "exception",
				to: "except-when",
				input: "exception",
			},
			{ id: "gate-outcome", from: "except-when", to: "outcome", when: "fail" },
			{ id: "in-crypto", from: "trigger", to: "crypto" },
			{
				id: "crypto-fails",
				from: "crypto",
				to: "crypto-block",
				when: "fail",
			},
			...exceptionRules.flatMap((ruleId) => [
				{ id: `in-${ruleId}`, from: "trigger", to: ruleId },
				{ id: `group-${ruleId}`, from: ruleId, to: "exception" },
			]),
		],
	};
}

async function buildCrm() {
	const repo = await crmRepo();
	const targetMain = await customRule(
		repo.repoId,
		"Target is main",
		{
			when: { id: "pr.targetBranch" },
			comparison: { kind: "equals", args: ["main"] },
		},
		true,
	);
	const targetRelease = await customRule(repo.repoId, "Target is release", {
		when: { id: "pr.targetBranch" },
		comparison: { kind: "equals", args: ["release"] },
	});
	const releaseSource = await customRule(
		repo.repoId,
		"Source starts with release-please",
		{
			when: { id: "pr.sourceBranch" },
			comparison: { kind: "startsWith", args: ["release-please"] },
		},
	);
	const releaseAuthor = await customRule(repo.repoId, "Release account", {
		when: { id: "contributor.login" },
		comparison: { kind: "equals", args: [RELEASE_ACCOUNT] },
	});
	const workflow = await workflowServices.createWorkflow(db, {
		repoId: repo.repoId,
		name: "Target is main",
		definition: crmWorkflow(targetMain, [
			targetRelease,
			releaseSource,
			releaseAuthor,
		]),
	});
	return { repo, targetMain, workflowId: workflow.id };
}

async function enable(repoId: string, workflowId: string) {
	const result = await workflowServices.setWorkflowEnabled(db, {
		repoId,
		workflowId,
		enabled: true,
	});
	expect(result.ok).toBe(true);
}

const RELEASE_PR: Pr = {
	target: "release",
	source: "release-please--branches--release",
	author: RELEASE_ACCOUNT,
};

describe("trycompai/crm built as a workflow", () => {
	test("a disabled workflow changes nothing, and enabling moves authority from the installed rule", async () => {
		const { repo, targetMain, workflowId } = await buildCrm();

		const before = await openPr(repo, RELEASE_PR, 1);
		expect(before.run.verdict).toBe("block");
		expect((await ruleView(repo.repoId, targetMain)).management).toBe(
			"standalone",
		);

		await enable(repo.repoId, workflowId);

		expect((await ruleView(repo.repoId, targetMain)).management).toBe(
			"managed",
		);
		const after = await openPr(repo, { ...RELEASE_PR, sha: "c".repeat(40) }, 2);
		expect(after.run.verdict).toBe("pass");
	});

	describe("acceptance cases", () => {
		let crm: Awaited<ReturnType<typeof buildCrm>>;
		let number = 100;

		beforeAll(async () => {
			crm = await buildCrm();
			await enable(crm.repo.repoId, crm.workflowId);
		});

		async function gateOutput(runId: string) {
			const rows = await pool.query(
				"SELECT output FROM run_steps WHERE run_id = $1 AND node_id LIKE '%:except-when'",
				[runId],
			);
			return rows.rows[0]?.output;
		}

		test("a normal PR into main passes and the unused exception checks hold nothing", async () => {
			const { run, executed } = await openPr(
				crm.repo,
				{ target: "main", source: "feat/login", author: "octocat" },
				number++,
			);
			expect(run).toMatchObject({ status: "completed", verdict: "pass" });
			expect(executed.some((action) => action.kind === "block")).toBe(false);
			expect(await gateOutput(run.id)).toMatchObject({
				requirement: "pass",
				exceptionApplied: false,
			});
		});

		test("a wrong target asks the author to fix it", async () => {
			const { run, executed } = await openPr(
				crm.repo,
				{ target: "develop", source: "feat/login", author: "octocat" },
				number++,
			);
			expect(run.verdict).toBe("changes_required");
			expect(commentBody(executed)).toContain(
				"Changes needed. Change the target to main.",
			);
			expect(executed.some((action) => action.kind === "block")).toBe(false);
		});

		test("a release PR into release from the selected account passes on the exception", async () => {
			const { run } = await openPr(crm.repo, RELEASE_PR, number++);
			expect(run.verdict).toBe("pass");
			expect(await gateOutput(run.id)).toMatchObject({
				requirement: "fail",
				exception: "pass",
				exceptionApplied: true,
			});
		});

		test("a spoofed source branch from another account does not get the exception", async () => {
			const { run, executed } = await openPr(
				crm.repo,
				{ ...RELEASE_PR, author: "mallory" },
				number++,
			);
			expect(run.verdict).toBe("changes_required");
			expect(commentBody(executed)).toContain("Change the target to main.");
		});

		test("the selected account with a source branch that is not release-please does not get it either", async () => {
			const { run } = await openPr(
				crm.repo,
				{ ...RELEASE_PR, source: "hotfix/release" },
				number++,
			);
			expect(run.verdict).toBe("changes_required");
		});

		test("a release PR with a crypto address is blocked and the exception still applied", async () => {
			const { run, executed } = await openPr(
				crm.repo,
				{ ...RELEASE_PR, title: `chore: release, tip ${ETH}` },
				number++,
			);
			expect(run.verdict).toBe("block");
			expect(commentBody(executed)).toContain("Crypto address");
			expect(commentBody(executed)).not.toContain("Change the target to main.");
			expect(await gateOutput(run.id)).toMatchObject({
				exceptionApplied: true,
			});
		});

		test("retargeting to main without a push re-runs and clears the fix", async () => {
			const pr = number++;
			const first = await openPr(
				crm.repo,
				{
					target: "develop",
					source: "feat/login",
					author: "octocat",
					sha: "d".repeat(40),
				},
				pr,
			);
			expect(first.run.verdict).toBe("changes_required");
			const retargeted = await openPr(
				crm.repo,
				{
					target: "main",
					source: "feat/login",
					author: "octocat",
					sha: "d".repeat(40),
					action: "edited",
					retargetedFrom: "develop",
				},
				pr,
			);
			expect(retargeted.run.verdict).toBe("pass");
		});
	});
});
