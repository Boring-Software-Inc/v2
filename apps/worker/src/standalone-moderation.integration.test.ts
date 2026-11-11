import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	CONTRIBUTOR_ALLOWLIST_RULE_ID,
	DEFAULT_WORKFLOW,
	type ModerationOutcome,
	type ModerationSubject,
	SHARED_BLOCKLIST_RULE_ID,
	SHARED_BLOCKLIST_RULE_VERSION,
	type SharedBlocklistSnapshot,
	standaloneModerationWaiverSchema,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import {
	applyMigrations,
	contributionAppealServices,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	moderationPolicyServices,
	moderationServices,
	repoServices,
	runServices,
	schema,
	type TestDatabase,
	workflowServices,
} from "@tripwire/db";
import type { ContributorProfile, ForgeAction } from "@tripwire/forge";
import { generateId } from "@tripwire/utils";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import issueFixture from "../../../packages/forge-github/fixtures/issue_comment.created.json";
import prFixture from "../../../packages/forge-github/fixtures/pull_request.opened.json";
import { staticForge } from "./forge-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { STANDALONE_OUTCOME_NODE } from "./jobs/standalone-moderation.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
let sequence = 0;
const logger = pino({ level: "silent" });
const beforeExemption = process.env.TRIPWIRE_DISABLE_EXEMPTION;
beforeAll(async () => {
	delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 120_000);
afterAll(async () => {
	if (beforeExemption === undefined)
		delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	else process.env.TRIPWIRE_DISABLE_EXEMPTION = beforeExemption;
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function setup(
	subject: ModerationSubject,
	outcome: ModerationOutcome,
	options: {
		issueEnabled?: boolean;
		maintainer?: boolean;
		missingAge?: boolean;
		unarmed?: boolean;
		bot?: boolean;
		profileUnavailable?: boolean;
		pilot?: "matched" | "unlisted" | "unavailable";
	} = {},
) {
	const fixture = subject === "issue" ? issueFixture : prFixture;
	const author =
		subject === "issue" ? issueFixture.issue.user : prFixture.pull_request.user;
	const name = `standalone-${++sequence}`;
	const externalId = String(fixture.repository.id + sequence);
	const fullName = `${fixture.repository.owner.login}/${name}`;
	const repoId = await repoServices.ensureRepo(db, {
		externalId,
		owner: fixture.repository.owner.login,
		name,
		fullName,
	});
	await repoServices.setRepoArmed(db, repoId, !options.unarmed);
	await moderationPolicyServices.upsertRepoPolicy(db, repoId, {
		defaults: { [subject]: outcome },
		issueRulesEnabled: options.issueEnabled !== false,
		ruleOutcomes: {},
	});
	if (options.pilot) {
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: SHARED_BLOCKLIST_RULE_ID,
			version: SHARED_BLOCKLIST_RULE_VERSION,
			enabled: true,
			config: {},
		});
	} else {
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "account-age",
			version: 1,
			enabled: true,
			config: { minDays: 30 },
		});
	}
	const executed: ForgeAction[] = [];
	const profile: ContributorProfile = {
		login: author.login,
		externalId: String(author.id),
		createdAt: options.missingAge ? null : new Date().toISOString(),
		followers: 0,
		following: 0,
		publicRepos: 0,
		profileText: null,
		mergedInRepo: 0,
		mergedElsewhere: 0,
		recentChangeRequestTimes: [],
		isMaintainer: options.maintainer ?? false,
		isOrgMember: options.maintainer ?? false,
	};
	const reads = {
		getDiff: () => Promise.resolve([]),
		getCommits: () => Promise.resolve([]),
		getContributorProfile: () =>
			options.profileUnavailable
				? Promise.reject(new Error("Profile unavailable"))
				: Promise.resolve(profile),
	};
	const loadPilotSnapshot =
		async (): Promise<SharedBlocklistSnapshot | null> =>
			options.pilot === "unavailable"
				? null
				: {
						version: 1,
						revision: 1,
						publishedAt: new Date().toISOString(),
						entries:
							options.pilot === "matched"
								? [
										{
											accountId: String(author.id),
											login: author.login,
											reason: "Fixture entry",
											expiresAt: null,
										},
									]
								: [],
					};
	const deps = {
		db,
		pool,
		logger,
		makeGenerate: null,
		loadPilotSnapshot: options.pilot ? loadPilotSnapshot : undefined,
		appUrl: "https://tripwire.test",
		resolveForge: staticForge({
			reads,
			adapter: {
				...reads,
				forge: "github",
				verifyWebhook: () => true,
				normalizeWebhook: () => null,
				readFile: () => Promise.resolve(null),
				execute: (action) => {
					executed.push(action);
					return Promise.resolve({ externalId: null });
				},
			},
		}),
	};
	async function deliver(action: "opened" | "synchronize" = "opened") {
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: `${name}-${++sequence}`,
			rawKind: subject === "issue" ? "issues" : "pull_request",
			raw: {
				...fixture,
				action,
				...(subject === "issue"
					? {
							issue: {
								...issueFixture.issue,
								user: options.bot
									? { ...author, login: "dependabot[bot]", type: "Bot" }
									: author,
								author_association: options.maintainer ? "OWNER" : "NONE",
							},
						}
					: {
							pull_request: {
								...prFixture.pull_request,
								user: options.bot
									? { ...author, login: "dependabot[bot]", type: "Bot" }
									: author,
							},
						}),
				repository: {
					...fixture.repository,
					id: Number(externalId),
					name,
					full_name: fullName,
				},
			},
		});
		if (!eventId) throw new Error("Missing event");
		await processEvent(deps, { eventId });
		const run = await runServices.getRunForEvent(db, eventId);
		return run ? await runServices.getRunWithSteps(db, run.id) : null;
	}
	return { repoId, executed, deliver, author, fullName, deps };
}

for (const subject of ["issue", "change-request"] as const) {
	describe(`${subject} standalone outcomes`, () => {
		for (const outcome of ["warn", "human-review", "block", "close"] as const) {
			test(`${outcome} uses the selected outcome and shared responses`, async () => {
				const fixture = await setup(subject, outcome);
				const data = await fixture.deliver();
				expect(data).not.toBeNull();
				const expectedVerdict =
					outcome === "warn"
						? "pass"
						: outcome === "human-review"
							? "needs_review"
							: outcome;
				expect(data?.run.verdict).toBe(expectedVerdict);
				expect(
					data?.steps.find(
						(step) =>
							step.nodeId ===
							`${DEFAULT_WORKFLOW.id}:${STANDALONE_OUTCOME_NODE}`,
					)?.output,
				).toMatchObject({
					outcome,
					ruleRef: "account-age@1",
					failed: [expect.objectContaining({ ref: "account-age@1", outcome })],
				});
				if (outcome === "warn") {
					expect(
						fixture.executed.some(
							(action) =>
								action.kind === "set-check" &&
								action.check.conclusion === "failure",
						),
					).toBe(false);
				}
				const kinds = fixture.executed.map((action) => action.kind);
				expect(kinds.includes("close")).toBe(outcome === "close");
				expect(kinds.includes("lock")).toBe(
					subject === "issue" && outcome === "block",
				);
				expect(kinds.includes("block")).toBe(
					subject !== "issue" && outcome === "block",
				);
				if (subject === "issue") expect(kinds).not.toContain("set-check");
				const comments = fixture.executed.filter(
					(action) => action.kind === "comment",
				);
				expect(comments).toHaveLength(1);
				if (comments[0]?.kind === "comment") {
					expect(comments[0].body).toContain(`/appeals/${data?.run.id}`);
					if (subject === "issue")
						expect(comments[0].body).not.toContain("change request");
				}
			});
		}
		test.each([
			"approve",
			"deny",
		] as const)("Human review %s resumes and applies the subject's outcome", async (decision) => {
			const fixture = await setup(subject, "human-review");
			const data = await fixture.deliver();
			if (!data) throw new Error("Missing run");
			const items = await moderationServices.listModerationItemsForRun(
				db,
				data.run.id,
			);
			const item = items[0];
			if (!item) throw new Error("Missing review item");
			expect(items).toHaveLength(1);
			await moderationServices.decideModerationItem(pool, boss, {
				itemId: item.id,
				decision,
				decidedBy: null,
			});
			await resumeRun(fixture.deps, {
				itemId: item.id,
				decision: decision === "approve" ? "deny" : "approve",
			});
			expect((await runServices.getRunById(db, data.run.id))?.status).toBe(
				"paused",
			);
			await resumeRun(fixture.deps, { itemId: item.id, decision });
			const final = await runServices.getRunById(db, data.run.id);
			expect(final).toMatchObject({
				status: "completed",
				verdict: decision === "approve" ? "pass" : "block",
			});
			expect(
				fixture.executed.some(
					(action) => action.kind === (subject === "issue" ? "lock" : "block"),
				),
			).toBe(decision === "deny");
		});
		test("strict allowlist evaluates maintainers", async () => {
			const fixture = await setup(subject, "block", { maintainer: true });
			await repoServices.upsertRuleConfig(db, fixture.repoId, {
				ruleId: CONTRIBUTOR_ALLOWLIST_RULE_ID,
				version: 1,
				enabled: true,
				config: {},
			});
			const blocked = await fixture.deliver();
			expect(blocked?.run.verdict).toBe("block");
			expect(
				blocked?.steps.filter((step) => step.nodeKind === "rule"),
			).toHaveLength(1);
			await moderationPolicyServices.addAllowlistEntry(db, fixture.repoId, {
				accountId: String(fixture.author.id),
				login: fixture.author.login,
			});
			const allowed = await fixture.deliver();
			expect(allowed?.run.verdict).toBe("pass");
			expect(
				allowed?.steps.some((step) =>
					step.nodeId.endsWith(STANDALONE_OUTCOME_NODE),
				),
			).toBe(false);
		});
		test("strict allowlist checks bot identities when profile reads are unavailable", async () => {
			const fixture = await setup(subject, "block", {
				bot: true,
				profileUnavailable: true,
			});
			await repoServices.upsertRuleConfig(db, fixture.repoId, {
				ruleId: CONTRIBUTOR_ALLOWLIST_RULE_ID,
				version: 1,
				enabled: true,
				config: {},
			});
			const data = await fixture.deliver();
			expect(data?.run.verdict).toBe("block");
			expect(
				data?.steps.find((step) => step.ruleId === "contributor-allowlist@1")
					?.status,
			).toBe("fail");
		});
		test("a strict allowlist workflow checks maintainers while ordinary rules stay exempt", async () => {
			const fixture = await setup(subject, "block", { maintainer: true });
			const definition: WorkflowDefinition = {
				id: "strict-workflow",
				name: "Strict workflow",
				version: 1,
				nodes: [
					{
						id: "t",
						type: "trigger",
						kinds: [
							subject === "issue" ? "issue.opened" : "change-request.opened",
						],
					},
					{
						id: "allowlist",
						type: "rule",
						ref: "contributor-allowlist@1",
						config: {},
					},
					{
						id: "age",
						type: "rule",
						ref: "account-age@1",
						config: { minDays: 30 },
					},
					{ id: "gate", type: "gate", mode: "all-of" },
					{ id: "close", type: "action", action: "close" },
				],
				edges: [
					{ id: "list", from: "t", to: "allowlist" },
					{ id: "age", from: "t", to: "age" },
					{ id: "list-gate", from: "allowlist", to: "gate" },
					{ id: "age-gate", from: "age", to: "gate" },
					{ id: "effect", from: "gate", to: "close", when: "fail" },
				],
			};
			const workflow = await workflowServices.createWorkflow(db, {
				repoId: fixture.repoId,
				name: definition.name,
				definition,
			});
			expect(
				await workflowServices.setWorkflowEnabled(db, {
					repoId: fixture.repoId,
					workflowId: workflow.id,
					enabled: true,
				}),
			).toMatchObject({ ok: true });
			const denied = await fixture.deliver();
			expect(
				denied?.steps.find((step) => step.ruleId === "contributor-allowlist@1")
					?.status,
			).toBe("fail");
			expect(
				denied?.steps.find((step) => step.ruleId === "account-age@1")?.status,
			).toBe("disabled");
			expect(fixture.executed.some((action) => action.kind === "close")).toBe(
				true,
			);
			fixture.executed.length = 0;
			await moderationPolicyServices.addAllowlistEntry(db, fixture.repoId, {
				accountId: String(fixture.author.id),
				login: fixture.author.login,
			});
			const allowed = await fixture.deliver();
			expect(
				allowed?.steps.find((step) => step.ruleId === "contributor-allowlist@1")
					?.status,
			).toBe("pass");
			expect(
				allowed?.steps.find((step) => step.ruleId === "account-age@1")?.status,
			).toBe("disabled");
			expect(fixture.executed.some((action) => action.kind === "close")).toBe(
				false,
			);
		});
		test("approved outsiders still run the repository's other rules", async () => {
			const fixture = await setup(subject, "block");
			await repoServices.upsertRuleConfig(db, fixture.repoId, {
				ruleId: CONTRIBUTOR_ALLOWLIST_RULE_ID,
				version: 1,
				enabled: true,
				config: {},
			});
			await moderationPolicyServices.addAllowlistEntry(db, fixture.repoId, {
				accountId: String(fixture.author.id),
				login: fixture.author.login,
			});
			const data = await fixture.deliver();
			expect(data?.run.verdict).toBe("block");
			expect(
				data?.steps
					.filter((step) => step.nodeKind === "rule")
					.map((step) => step.status)
					.sort(),
			).toEqual(["fail", "pass"]);
		});
		test("the strongest failed rule wins and all failures remain in the audit", async () => {
			const fixture = await setup(subject, "warn");
			await repoServices.upsertRuleConfig(db, fixture.repoId, {
				ruleId: "profile-readme",
				version: 1,
				enabled: true,
				config: { minLength: 32 },
			});
			await moderationPolicyServices.updateRepoPolicy(db, fixture.repoId, {
				ruleOutcome: { ruleId: "profile-readme", subject, outcome: "close" },
			});
			const data = await fixture.deliver();
			expect(data?.run.verdict).toBe("close");
			const actions = data?.actions.filter((action) =>
				["note", "close", "block", "lock"].includes(action.kind),
			);
			expect(actions?.map((action) => action.kind)).toEqual(["close"]);
			expect(
				data?.steps.find((step) =>
					step.nodeId.endsWith(STANDALONE_OUTCOME_NODE),
				)?.output,
			).toMatchObject({
				outcome: "close",
				ruleRef: "profile-readme@1",
				failed: [
					expect.objectContaining({ ref: "account-age@1", outcome: "warn" }),
					expect.objectContaining({
						ref: "profile-readme@1",
						outcome: "close",
					}),
				],
			});
		});
		test("maintainers remain exempt when strict allowlist is off", async () => {
			const fixture = await setup(subject, "close", { maintainer: true });
			expect(await fixture.deliver()).toBeNull();
			expect(fixture.executed).toEqual([]);
		});
		test("a skipped check never closes or blocks", async () => {
			const fixture = await setup(subject, "close", { missingAge: true });
			const data = await fixture.deliver();
			expect(
				data?.steps.some(
					(step) => step.nodeKind === "rule" && step.status === "skipped",
				),
			).toBe(true);
			expect(
				fixture.executed.some((action) =>
					["close", "lock", "block"].includes(action.kind),
				),
			).toBe(false);
		});
		test("explicit workflow ownership overrides standalone policy", async () => {
			const fixture = await setup(subject, "close");
			const definition: WorkflowDefinition = {
				id: "custom-owned",
				name: "Custom outcome",
				version: 1,
				nodes: [
					{
						id: "trigger",
						type: "trigger",
						kinds: [
							subject === "issue" ? "issue.opened" : "change-request.opened",
						],
					},
					{
						id: "age",
						type: "rule",
						ref: "account-age@1",
						config: { minDays: 30 },
					},
					{
						id: "comment",
						type: "action",
						action: "post-comment",
						params: { message: "Custom workflow response" },
					},
				],
				edges: [
					{ id: "to-rule", from: "trigger", to: "age" },
					{ id: "to-comment", from: "age", to: "comment", when: "fail" },
				],
			};
			const workflow = await workflowServices.createWorkflow(db, {
				repoId: fixture.repoId,
				name: definition.name,
				definition,
			});
			expect(
				await workflowServices.setWorkflowEnabled(db, {
					repoId: fixture.repoId,
					workflowId: workflow.id,
					enabled: true,
				}),
			).toMatchObject({ ok: true });
			await fixture.deliver();
			expect(fixture.executed.some((action) => action.kind === "close")).toBe(
				false,
			);
			expect(fixture.executed).toContainEqual(
				expect.objectContaining({
					kind: "post-comment",
					body: "Custom workflow response",
				}),
			);
		});
		test("unarmed repositories have no effects", async () => {
			const fixture = await setup(subject, "close", { unarmed: true });
			expect(await fixture.deliver()).toBeNull();
			expect(fixture.executed).toEqual([]);
		});
	});
}

test("standalone issue rules require explicit repository opt-in", async () => {
	const fixture = await setup("issue", "close", { issueEnabled: false });
	expect(await fixture.deliver()).toBeNull();
	expect(fixture.executed).toEqual([]);
});

test("Pilot runs on opted-in issues and follows the issue outcome override", async () => {
	const fixture = await setup("issue", "warn", { pilot: "matched" });
	const warned = await fixture.deliver();
	expect(warned?.run.verdict).toBe("pass");
	expect(
		warned?.steps.find((step) => step.nodeId.endsWith(STANDALONE_OUTCOME_NODE))
			?.output,
	).toMatchObject({
		outcome: "warn",
		ruleRef: `${SHARED_BLOCKLIST_RULE_ID}@${SHARED_BLOCKLIST_RULE_VERSION}`,
	});
	await moderationPolicyServices.updateRepoPolicy(db, fixture.repoId, {
		ruleOutcome: {
			ruleId: SHARED_BLOCKLIST_RULE_ID,
			subject: "issue",
			outcome: "close",
		},
	});
	const closed = await fixture.deliver();
	expect(closed?.run.verdict).toBe("close");
	expect(fixture.executed.some((action) => action.kind === "close")).toBe(true);
});

test("Pilot stays off on issues until standalone issue moderation is enabled", async () => {
	const fixture = await setup("issue", "close", {
		pilot: "matched",
		issueEnabled: false,
	});
	expect(await fixture.deliver()).toBeNull();
	expect(fixture.executed).toEqual([]);
});

test.each([
	"unlisted",
	"unavailable",
] as const)("Pilot does not close an issue when the snapshot is %s", async (pilot) => {
	const fixture = await setup("issue", "close", { pilot });
	const data = await fixture.deliver();
	expect(data?.run.verdict).toBe("pass");
	expect(
		data?.steps.find(
			(step) =>
				step.ruleId ===
				`${SHARED_BLOCKLIST_RULE_ID}@${SHARED_BLOCKLIST_RULE_VERSION}`,
		)?.status,
	).toBe(pilot === "unlisted" ? "pass" : "skipped");
	expect(fixture.executed.some((action) => action.kind === "close")).toBe(
		false,
	);
});

test("Pilot keeps the historical Human review outcome for open pull requests", async () => {
	const fixture = await setup("change-request", "close", { pilot: "matched" });
	const data = await fixture.deliver();
	expect(data?.run.verdict).toBe("needs_review");
	expect(fixture.executed.some((action) => action.kind === "close")).toBe(
		false,
	);
});

test("Pilot does not run standalone on PR updates", async () => {
	const fixture = await setup("change-request", "close", { pilot: "matched" });
	const updated = await fixture.deliver("synchronize");
	expect(updated?.run.verdict).toBe("pass");
	expect(
		updated?.steps.some((step) =>
			step.ruleId?.startsWith(SHARED_BLOCKLIST_RULE_ID),
		),
	).toBe(false);
	expect(fixture.executed.some((action) => action.kind === "close")).toBe(
		false,
	);
});

test("an issue workflow owning Pilot keeps control of the outcome", async () => {
	const fixture = await setup("issue", "close", { pilot: "matched" });
	const definition: WorkflowDefinition = {
		id: "issue-pilot",
		name: "Issue Pilot",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["issue.opened"] },
			{
				id: "pilot",
				type: "rule",
				ref: `${SHARED_BLOCKLIST_RULE_ID}@${SHARED_BLOCKLIST_RULE_VERSION}`,
				config: {},
			},
			{
				id: "message",
				type: "action",
				action: "post-comment",
				params: { message: "Please contact a maintainer." },
			},
		],
		edges: [
			{ id: "to-pilot", from: "t", to: "pilot" },
			{ id: "to-message", from: "pilot", to: "message", when: "fail" },
		],
	};
	const workflow = await workflowServices.createWorkflow(db, {
		repoId: fixture.repoId,
		name: definition.name,
		definition,
	});
	expect(
		await workflowServices.setWorkflowEnabled(db, {
			repoId: fixture.repoId,
			workflowId: workflow.id,
			enabled: true,
		}),
	).toMatchObject({ ok: true });
	const data = await fixture.deliver();
	expect(
		data?.steps.filter((step) =>
			step.ruleId?.startsWith(SHARED_BLOCKLIST_RULE_ID),
		),
	).toHaveLength(1);
	expect(fixture.executed).toEqual([
		expect.objectContaining({
			kind: "post-comment",
			body: "Please contact a maintainer.",
		}),
	]);
});

test("a contribution approval waives the standalone outcome on a later delivery", async () => {
	const fixture = await setup("change-request", "block");
	const initial = await fixture.deliver();
	if (!initial) throw new Error("Expected a blocked run");
	expect(initial.run.verdict).toBe("block");
	expect(initial.run.subjectKind).toBe("change-request");

	const userId = generateId();
	await db.insert(schema.user).values({
		id: userId,
		name: "Contributor",
		email: `${userId}@example.test`,
	});
	await db.insert(schema.account).values({
		id: generateId(),
		userId,
		providerId: "github",
		accountId: String(fixture.author.id),
	});
	const submitted = await contributionAppealServices.submitAppeal(db, {
		runId: initial.run.id,
		userId,
		reason: "Review this contribution",
	});
	expect(submitted?.status).toBe("pending");
	const [appeal] = await contributionAppealServices.listPendingAppeals(
		db,
		fixture.repoId,
	);
	if (!appeal) throw new Error("Expected a pending appeal");
	await contributionAppealServices.decideAppeal(
		db,
		{
			repoId: fixture.repoId,
			appealId: appeal.id,
			decidedBy: userId,
			decision: "approve-once",
		},
		async () => {},
	);

	fixture.executed.length = 0;
	const next = await fixture.deliver();
	expect(next?.run.verdict).toBe("pass");
	expect(
		next?.steps.some(
			(step) => standaloneModerationWaiverSchema.safeParse(step.output).success,
		),
	).toBe(true);
	expect(fixture.executed.some((action) => action.kind === "block")).toBe(
		false,
	);
});

test("the review queue shows the original issue title", async () => {
	const fixture = await setup("issue", "human-review");
	const result = await fixture.deliver();
	if (!result) throw new Error("Expected an issue review");
	const rows = await moderationServices.listPendingItems(db, [
		{ forge: "github", fullName: fixture.fullName },
	]);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.title).toBe(issueFixture.issue.title);
});
