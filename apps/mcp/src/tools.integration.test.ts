import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	AI_CREDITS_COPY,
	compileWorkflows,
	liveNodeTouches,
	workflowAuthoring,
	workflowPushProposalResultSchema,
	workflowPushViewSchema,
} from "@tripwire/contracts";
import {
	agentServices,
	agentWorkServices,
	aiProviderServices,
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	DEMO_EMAIL_DOMAIN,
	ensureDemoRepo,
	ensureTeamOrg,
	orgServices,
	runServices,
	schema,
	seedRun,
	type TestDatabase,
	workflowPushServices,
	workflowServices,
} from "@tripwire/db";
import type { Pool } from "pg";
import { z } from "zod";
import { readConfig } from "./config.ts";
import { RELEASE_EXAMPLE } from "./custom-rule-guide.ts";
import { registerTools, SWITCH_ACCOUNT_STEPS } from "./tools.ts";

const config = readConfig({
	BETTER_AUTH_SECRET: "test-secret",
	APP_URL: "http://localhost:3420",
	MCP_PUBLIC_URL: "http://localhost:3421/mcp",
});

const SCOPES = [
	"tripwire:read",
	"tripwire:configure",
	"tripwire:moderate",
	"tripwire:admin",
] as const;

const textSchema = z.object({
	isError: z.boolean().optional(),
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
	structuredContent: z.record(z.string(), z.unknown()).optional(),
});

const runsSchema = z.array(
	z.object({ id: z.string(), repo: z.string(), number: z.number() }),
);

let container: TestDatabase;
let db: Db;
let pool: Pool;
let client: Client;
let orgSlug: string;
let fullNames: string[];
let repoRows: Awaited<ReturnType<typeof ensureDemoRepo>>[];
const USER_ID = "mcp-tools-user";
const clients: Client[] = [];

async function connect(
	orgIds: string[],
	clientId = "test-client",
): Promise<Client> {
	const server = new McpServer({ name: "tripwire-test", version: "0.0.0" });
	registerTools(
		server,
		{
			db,
			pool,
			getBoss: () => Promise.reject(new Error("no queue in tests")),
			config,
			agent: {
				userId: USER_ID,
				clientId,
				scopes: [...SCOPES],
				orgIds,
			},
			accessDenied: null,
		},
		{ scopes: [...SCOPES], readOnly: false },
	);
	const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	const connected = new Client({ name: "test", version: "0.0.0" });
	await connected.connect(clientSide);
	clients.push(connected);
	return connected;
}

async function orgId(): Promise<string | undefined> {
	const orgs = await orgServices.listUserOrgs(db, USER_ID);
	return orgs.find((org) => org.slug === orgSlug)?.id;
}

function never(): never {
	throw new Error("missing test fixture");
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	const userId = USER_ID;
	await db
		.insert(schema.user)
		.values({
			id: userId,
			name: userId,
			email: `${userId}@${DEMO_EMAIL_DOMAIN}`,
		})
		.onConflictDoNothing();
	const org = await ensureTeamOrg(db, {
		adminUserId: userId,
		memberUserIds: [],
	});
	orgSlug = org.slug;
	const repos = [
		await ensureDemoRepo(db, "mcp-api", { installationId: "mcp-inst" }),
		await ensureDemoRepo(db, "mcp-web", { installationId: "mcp-inst" }),
	];
	await orgServices.linkOrgInstallation(db, {
		orgId: org.id,
		installationId: "mcp-inst",
	});
	fullNames = repos.map((repo) => repo.fullName);
	repoRows = repos;
	let number = 1;
	for (const repo of repos) {
		await seedRun({
			db,
			repo,
			actor: { login: "someone", externalId: "4000" },
			number: number++,
			title: `run on ${repo.name}`,
			verdict: "pass",
			at: new Date(),
		});
	}
	client = await connect([org.id]);
}, 120_000);

afterAll(async () => {
	for (const open of clients) {
		await open.close().catch(() => undefined);
	}
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function call(name: string, args: Record<string, unknown>) {
	return textSchema.parse(await client.callTool({ name, arguments: args }));
}

describe("list_runs", () => {
	test("without repo lists runs on every repo in the org", async () => {
		const result = await call("list_runs", {});
		expect(result.isError).toBeFalsy();
		const runs = runsSchema.parse(JSON.parse(result.content[0]?.text ?? ""));
		expect(new Set(runs.map((run) => run.repo))).toEqual(new Set(fullNames));
	});

	test("with repo by name or owner/name lists that repo only", async () => {
		for (const repo of ["mcp-api", fullNames[0] ?? ""]) {
			const result = await call("list_runs", { repo });
			const runs = runsSchema.parse(JSON.parse(result.content[0]?.text ?? ""));
			expect(runs.map((run) => run.repo)).toEqual([fullNames[0] ?? ""]);
		}
	});

	test("an owner that does not match is not found", async () => {
		const result = await call("list_runs", { repo: "someone-else/mcp-api" });
		expect(result.isError).toBe(true);
	});
});

describe("get_run", () => {
	test("steps name their workflow, title, gate mode and outcome", async () => {
		const listed = await call("list_runs", { repo: "mcp-api" });
		const runId = runsSchema.parse(JSON.parse(listed.content[0]?.text ?? ""))[0]
			?.id;
		await pool.query(
			"UPDATE run_steps SET node_id = 'seeded:' || node_id WHERE run_id = $1",
			[runId],
		);
		await pool.query("UPDATE runs SET workflow_snapshot = $2 WHERE id = $1", [
			runId,
			JSON.stringify([
				{
					id: "seeded",
					name: "Seeded gate",
					version: 1,
					nodes: [
						{
							id: "trigger",
							type: "trigger",
							kinds: ["change-request.opened"],
						},
						{ id: "gate", type: "gate", mode: "any-of" },
					],
					edges: [],
				},
			]),
		]);
		const result = await call("get_run", { runId });
		expect(result.isError).toBeFalsy();
		const run = JSON.parse(result.content[0]?.text ?? "");
		expect(run.createdAt).toMatch(/Z$/);
		expect(run.steps).toContainEqual(
			expect.objectContaining({
				workflow: "Seeded gate",
				stepId: "trigger",
				step: "Trigger",
				outcome: "Ran",
			}),
		);
		expect(run.steps).toContainEqual(
			expect.objectContaining({
				workflow: "Seeded gate",
				stepId: "gate",
				step: "Any of",
				gate: "any of",
				outcome: "Passes",
			}),
		);
	});
});

describe("get_run reads like the run page", () => {
	test("verdict words, steps grouped by workflow, and the unrunnable workflow named", async () => {
		const listed = await call("list_runs", { repo: "mcp-web" });
		const runId = runsSchema.parse(JSON.parse(listed.content[0]?.text ?? ""))[0]
			?.id;
		await pool.query("UPDATE runs SET verdict = 'needs_review' WHERE id = $1", [
			runId,
		]);
		await pool.query(
			`INSERT INTO run_steps (id, run_id, node_id, node_kind, status, output, started_at, finished_at, duration_ms)
			 VALUES ($1, $2, 'run:unrunnable', 'gate', 'skipped', $3, now() - interval '1 hour', now() - interval '1 hour', 0)`,
			[
				"mcp-unrunnable-step",
				runId,
				JSON.stringify({
					workflows: [{ id: "broken", name: "Crypto or honeypot" }],
					issues: [
						{
							workflowId: "broken",
							messages: ["All of: It takes rule results, not events"],
						},
					],
				}),
			],
		);
		const result = await call("get_run", { runId });
		const run = JSON.parse(result.content[0]?.text ?? "");
		expect(run.verdict).toBe("needs_review");
		expect(run.verdictLabel).toBe("Waiting for human review");
		const unrunnable = run.steps.find(
			(step: { status: string }) => step.status === "skipped",
		);
		expect(unrunnable).toMatchObject({
			workflow: "Crypto or honeypot",
			outcome: "Could not run",
			kind: "gate",
			status: "skipped",
		});
	});
});

describe("a backfill run (R7-1)", () => {
	test("list_runs and get_run mark it as history in would-have words", async () => {
		const runId = await seedRun({
			db,
			repo: repoRows[0] ?? never(),
			actor: { login: "someone", externalId: "4001" },
			number: 94,
			title: "backfilled",
			verdict: "needs_review",
			at: new Date(),
		});
		await pool.query(
			"UPDATE runs SET status = 'completed', backfill = true WHERE id = $1",
			[runId],
		);
		await pool.query("DELETE FROM moderation_items WHERE run_id = $1", [runId]);
		const got = JSON.parse(
			(await call("get_run", { runId })).content[0]?.text ?? "",
		);
		expect(got).toMatchObject({
			backfill: true,
			verdictLabel: "Would go to human review",
		});
		const listed = z
			.array(
				z.object({
					id: z.string(),
					backfill: z.boolean(),
					verdictLabel: z.string().nullable(),
				}),
			)
			.parse(
				JSON.parse(
					(await call("list_runs", { repo: "mcp-api" })).content[0]?.text ?? "",
				),
			);
		expect(listed.find((row) => row.id === runId)).toMatchObject({
			backfill: true,
			verdictLabel: "Would go to human review",
		});
	});
});

describe("a run whose change request closed before review", () => {
	async function closedRun(number: number) {
		const runId = await seedRun({
			db,
			repo: repoRows[0] ?? never(),
			actor: { login: "someone", externalId: "4000" },
			number,
			title: "closed before review",
			verdict: "needs_review",
			at: new Date(),
		});
		await pool.query(
			"UPDATE runs SET status = 'closed', completed_at = now() WHERE id = $1",
			[runId],
		);
		await runServices.recordSteps(db, runId, [
			{
				nodeId: "review:hold",
				nodeKind: "action",
				status: "paused",
				input: null,
				output: null,
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				durationMs: 0,
			},
		]);
		const items = await pool.query<{ id: string }>(
			"UPDATE moderation_items SET status = 'closed', decided_at = now() WHERE run_id = $1 RETURNING id",
			[runId],
		);
		return { runId, itemId: items.rows[0]?.id ?? never() };
	}

	test("get_run and list_runs read Closed before review", async () => {
		const { runId } = await closedRun(90);
		const got = JSON.parse(
			(await call("get_run", { runId })).content[0]?.text ?? "",
		);
		expect(got).toMatchObject({
			status: "closed",
			verdict: "needs_review",
			result: "closed-before-review",
			verdictLabel: "Closed before review",
		});
		const waiting = z
			.array(z.object({ status: z.string(), outcome: z.string() }))
			.parse(got.steps)
			.filter((row) => row.status === "paused");
		expect(waiting.map((row) => row.outcome)).toEqual(["Closed before review"]);
		const listed = z
			.array(
				z.object({
					id: z.string(),
					result: z.string().nullable(),
					verdictLabel: z.string().nullable(),
				}),
			)
			.parse(
				JSON.parse(
					(await call("list_runs", { repo: "mcp-api" })).content[0]?.text ?? "",
				),
			);
		expect(listed.find((row) => row.id === runId)).toMatchObject({
			result: "closed-before-review",
			verdictLabel: "Closed before review",
		});
	});

	test("deciding its review item is an error that says it closed", async () => {
		const { itemId } = await closedRun(92);
		const result = await call("decide_moderation", {
			repo: "mcp-api",
			itemId,
			decision: "approve",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"closed with its change request #92",
		);
	});
});

describe("a comment run reads Ran", () => {
	test("get_run keeps the raw verdict and labels it Ran", async () => {
		const runId = await seedRun({
			db,
			repo: repoRows[1] ?? never(),
			actor: { login: "someone", externalId: "4000" },
			number: 91,
			title: "comment run",
			verdict: "pass",
			at: new Date(),
		});
		await pool.query(
			"UPDATE events SET kind = 'comment.created' WHERE id = (SELECT event_id FROM runs WHERE id = $1)",
			[runId],
		);
		const got = JSON.parse(
			(await call("get_run", { runId })).content[0]?.text ?? "",
		);
		expect(got).toMatchObject({
			verdict: "pass",
			result: "ran",
			verdictLabel: "Ran",
		});
	});
});

describe("list_workflows says what can run, like the web list", () => {
	test("a trigger wired into all-of can neither run nor be turned on", async () => {
		await call("apply_workflow", {
			repo: "mcp-web",
			definitions: [
				{
					id: "bad-allof-trigger",
					name: "bad-allof-trigger",
					version: 1,
					nodes: [
						{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
						{ id: "g", type: "gate", mode: "all-of" },
						{ id: "b", type: "action", action: "block" },
					],
					edges: [
						{ id: "e1", from: "t", to: "g" },
						{ id: "e2", from: "g", to: "b", when: "fail" },
					],
				},
			],
		});
		const result = await call("list_workflows", { repo: "mcp-web" });
		const listed = JSON.parse(result.content[0]?.text ?? "[]");
		expect(listed).toContainEqual(
			expect.objectContaining({
				name: "bad-allof-trigger",
				enabled: false,
				runnable: false,
				canTurnOn: false,
				state: "cant-turn-on",
			}),
		);
	});
});

async function addOrg(
	slug: string,
	input: { member: boolean; repo: string; installationId: string },
): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.insert(schema.organization)
		.values({ id, name: slug, slug, isPersonal: false });
	if (input.member) {
		await db.insert(schema.member).values({
			id: crypto.randomUUID(),
			organizationId: id,
			userId: USER_ID,
			role: "admin",
		});
	}
	await ensureDemoRepo(db, input.repo, {
		installationId: input.installationId,
	});
	await orgServices.linkOrgInstallation(db, {
		orgId: id,
		installationId: input.installationId,
	});
	return id;
}

describe("a repo argument names the repo the way people copy it", () => {
	const listed = async (target: Client, args: { org?: string; repo: string }) =>
		textSchema.parse(
			await target.callTool({ name: "list_workflows", arguments: args }),
		);

	test("by name, org/name, GitHub owner/name, or a pasted web URL", async () => {
		for (const repo of [
			"mcp-web",
			`${orgSlug}/mcp-web`,
			fullNames[1] ?? never(),
			`https://staging.tripwire.sh/${orgSlug}/mcp-web`,
			`https://staging.tripwire.sh/${orgSlug}/mcp-web/workflows/abc`,
			`https://github.com/${fullNames[1] ?? never()}`,
		]) {
			const result = await listed(client, { repo });
			expect({ repo, error: result.isError ?? false }).toEqual({
				repo,
				error: false,
			});
		}
	});

	test("an org in the argument picks that org over the selected one", async () => {
		const otherId = await addOrg("other-team", {
			member: true,
			repo: "other-repo",
			installationId: "other-inst",
		});
		const both = await connect([(await orgId()) ?? never(), otherId]);
		const result = await listed(both, {
			org: orgSlug,
			repo: "other-team/other-repo",
		});
		expect(result.isError ?? false).toBe(false);
		const plain = await listed(both, { org: orgSlug, repo: "other-repo" });
		expect(plain.structuredContent).toEqual({
			error: `The org ${orgSlug} has no repo named other-repo.`,
			hint: "list_repos",
			org: orgSlug,
		});
	});

	test("an org the agent was not given is named in the error", async () => {
		const result = await listed(client, { repo: "other-team/other-repo" });
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"This agent was not given access to other-team.",
		);
	});

	test("a scope that is no org of the user's reads as a GitHub owner or org they are not in", async () => {
		await addOrg("stranger-team", {
			member: false,
			repo: "stranger-repo",
			installationId: "stranger-inst",
		});
		const result = await listed(client, {
			repo: "stranger-team/stranger-repo",
		});
		expect(result.structuredContent).toEqual({
			error: `The org ${orgSlug} has no repo stranger-team/stranger-repo, and stranger-team is not a Tripwire org you are in.`,
			hint: "list_repos",
			org: orgSlug,
		});
	});
});

describe("AI review while Tripwire is out of AI credits", () => {
	test("set_rule refuses to turn it on, and get_repo_rules says it can't run", async () => {
		await aiProviderServices.recordAiCredits(db, "out");
		try {
			const refused = await call("set_rule", {
				repo: "mcp-api",
				ruleId: "ai-review",
				enabled: true,
			});
			expect(refused.isError).toBe(true);
			expect(refused.structuredContent?.error).toBe(AI_CREDITS_COPY.cantRun);
			const rules = z
				.array(
					z.object({ ruleId: z.string(), cannotRun: z.string().nullable() }),
				)
				.parse(
					JSON.parse(
						(await call("get_repo_rules", { repo: "mcp-api" })).content[0]
							?.text ?? "",
					),
				);
			expect(rules.find((rule) => rule.ruleId === "ai-review")?.cannotRun).toBe(
				AI_CREDITS_COPY.reason,
			);
		} finally {
			await aiProviderServices.recordAiCredits(db, "ready");
		}
	});
});

describe("tool errors", () => {
	test("keep tool names out of the message and put them in the hint", async () => {
		const result = await call("list_workflows", { repo: "scratch" });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			error: `The org ${orgSlug} has no repo named scratch.`,
			hint: "list_repos",
			org: orgSlug,
		});
		expect(result.content[0]?.text).toBe(
			`The org ${orgSlug} has no repo named scratch. Call list_repos to see the repos.`,
		);
	});

	test("an unknown org hints at whoami", async () => {
		const result = await call("list_repos", { org: "nope-org" });
		expect(result.structuredContent).toEqual({
			error: "No org named nope-org for this account.",
			hint: "list_orgs",
		});
	});
});

describe("whoami", () => {
	test("names the GitHub login the agent is signed in as", async () => {
		await db
			.insert(schema.forgeIdentities)
			.values({
				id: "mcp-tools-identity",
				userId: USER_ID,
				forge: "github",
				externalId: "mcp-tools-4242",
				username: "old-account",
			})
			.onConflictDoNothing();
		const result = await call("whoami", {});
		expect(result.isError).toBeFalsy();
		expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({
			signedInAs: "@old-account on GitHub",
			user: { id: USER_ID, githubLogin: "old-account" },
		});
	});
});

describe("switch_account", () => {
	const agentClient = (clientId: string) => ({
		clientId,
		name: clientId,
		scopes: ["tripwire:read"],
		grantTypes: ["authorization_code", "refresh_token"],
		resource: {
			identifier: config.resource,
			name: "Tripwire",
			allowedScopes: ["tripwire:read"],
		},
	});

	test("ends only the calling agent's sign-in and says how to reconnect", async () => {
		const id = await orgId();
		if (!id) {
			never();
		}
		for (const clientId of ["switching-agent", "other-agent"]) {
			await agentServices.ensurePublicAgentClient(db, agentClient(clientId));
			await agentServices.saveAgentGrant(db, {
				userId: USER_ID,
				clientId,
				orgIds: [id],
			});
		}
		const switching = await connect([id], "switching-agent");
		const result = textSchema.parse(
			await switching.callTool({ name: "switch_account", arguments: {} }),
		);
		expect(result.isError).toBeFalsy();
		const body = JSON.parse(result.content[0]?.text ?? "");
		expect(body.reconnect).toEqual(SWITCH_ACCOUNT_STEPS);
		expect(body.reconnect.claudeCode).toBe(
			"Reconnect Tripwire: run /mcp, pick tripwire, then Authenticate.",
		);
		expect(
			await agentServices.getAgentGrant(db, {
				userId: USER_ID,
				clientId: "switching-agent",
			}),
		).toBeNull();
		expect(
			await agentServices.getAgentGrant(db, {
				userId: USER_ID,
				clientId: "other-agent",
			}),
		).not.toBeNull();
	});
});

describe("list_moderation_queue", () => {
	test("works without repo", async () => {
		const result = await call("list_moderation_queue", {});
		expect(result.isError).toBeFalsy();
		expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({
			items: [],
		});
	});
});

describe("workflows as code", () => {
	const definition = {
		id: "mcp-as-code",
		name: "as code over mcp",
		version: 1,
		nodes: [
			{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] },
			{
				id: "account-age",
				type: "rule",
				ref: "account-age@1",
				config: { minDays: 7 },
			},
			{
				id: "hook",
				type: "action",
				action: "webhook",
				params: { url: "https://internal.example/steal" },
			},
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "trigger", to: "account-age" },
			{ id: "e2", from: "account-age", to: "block", when: "fail" },
			{ id: "e3", from: "account-age", to: "hook", when: "fail" },
		],
	};
	const body = (result: { content: { text?: string }[] }) =>
		z.json().parse(JSON.parse(result.content[0]?.text ?? "null"));

	test("validate reports issues and the changes apply would make", async () => {
		const result = await call("validate_workflow", {
			repo: "mcp-api",
			definitions: [definition],
		});
		expect(result.isError).toBeFalsy();
		expect(body(result)).toMatchObject({
			valid: false,
			workflows: [
				{
					id: "mcp-as-code",
					valid: false,
					issues: [{ step: "Webhook", rule: "action-params" }],
					changes: [{ change: "added", subject: "workflow" }],
				},
			],
		});
		expect(JSON.stringify(body(result))).not.toContain("internal.example");
	});

	test("a pulled live webhook workflow validates as its push would save", async () => {
		const repo = repoRows[0] ?? never();
		const created = await workflowServices.createWorkflow(db, {
			repoId: repo.id,
			name: "pulled hook",
			definition: {
				id: "mcp-pulled-hook",
				name: "pulled hook",
				version: 1,
				nodes: [
					{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
					{
						id: "hook",
						type: "action",
						action: "webhook",
						params: { url: "https://hooks.example.com/tripwire" },
					},
				],
				edges: [{ id: "e1", from: "t", to: "hook" }],
			},
		});
		await workflowServices.setWorkflowEnabled(db, {
			repoId: repo.id,
			workflowId: created.id,
			enabled: true,
		});
		const code = await call("get_workflow", {
			repo: "mcp-api",
			workflow: "mcp-pulled-hook",
		});
		expect(JSON.stringify(body(code))).not.toContain("hooks.example.com");
		const checked = await call("validate_workflow", {
			repo: "mcp-api",
			definitions: [
				{
					id: "mcp-pulled-hook",
					name: "pulled hook",
					version: 1,
					nodes: [
						{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
						{ id: "hook", type: "action", action: "webhook" },
					],
					edges: [{ id: "e1", from: "t", to: "hook" }],
				},
			],
		});
		expect(body(checked)).toMatchObject({
			valid: true,
			workflows: [
				{ id: "mcp-pulled-hook", enabled: true, valid: true, changes: [] },
			],
		});
	});

	test("apply creates it off and never stores a URL sent as code", async () => {
		const result = await call("apply_workflow", {
			repo: "mcp-api",
			definitions: [definition],
		});
		expect(body(result)).toMatchObject({
			workflows: [{ id: "mcp-as-code", outcome: "created", enabled: false }],
		});
		const again = await call("apply_workflow", {
			repo: "mcp-api",
			definitions: [definition],
		});
		expect(body(again)).toMatchObject({
			workflows: [{ outcome: "unchanged" }],
		});
	});

	test("a refused enable names the step and the reason", async () => {
		const result = await call("set_workflow_enabled", {
			repo: "mcp-api",
			workflowId: "mcp-as-code",
			enabled: true,
		});
		expect(result.isError).toBe(true);
		const error = String(result.structuredContent?.error ?? "");
		expect(error).toMatch(
			/^Workflow mcp-as-code cannot be turned on\. Webhook: \S/,
		);
		expect(error).not.toContain(";");
	});

	test("a refused push names the step, and validate says the workflow is on", async () => {
		const live = {
			...definition,
			id: "mcp-live",
			name: "live over mcp",
			nodes: definition.nodes.filter((node) => node.id !== "hook"),
			edges: definition.edges.filter((edge) => edge.to !== "hook"),
		};
		await call("apply_workflow", { repo: "mcp-api", definitions: [live] });
		const on = await call("set_workflow_enabled", {
			repo: "mcp-api",
			workflowId: "mcp-live",
			enabled: true,
		});
		expect(on.isError).toBeFalsy();
		const broken = {
			...live,
			nodes: [...live.nodes, { id: "either", type: "gate", mode: "any-of" }],
			edges: [...live.edges, { id: "e9", from: "either", to: "block" }],
		};
		const checked = await call("validate_workflow", {
			repo: "mcp-api",
			definitions: [broken],
		});
		expect(body(checked)).toMatchObject({
			workflows: [{ id: "mcp-live", enabled: true, valid: false }],
		});
		const pushed = await call("apply_workflow", {
			repo: "mcp-api",
			definitions: [broken],
		});
		const refused = z
			.object({
				workflows: z.array(
					z.object({ outcome: z.string(), issues: z.array(z.string()) }),
				),
			})
			.parse(body(pushed)).workflows[0];
		expect(refused?.outcome).toBe("refused");
		expect(refused?.issues.some((issue) => issue.startsWith("Any of: "))).toBe(
			true,
		);
		expect(body(pushed)).toMatchObject({
			workflows: [{ reason: "live-cannot-run" }],
		});
	});

	test("a new workflow pushed with a taken name is refused for its name", async () => {
		const pushed = await call("apply_workflow", {
			repo: "mcp-api",
			definitions: [{ ...definition, id: "mcp-clash", name: "live over mcp" }],
		});
		expect(body(pushed)).toEqual({
			workflows: [
				{
					id: "mcp-clash",
					outcome: "refused",
					reason: "name-taken",
					issues: [
						"Another workflow on this repo is named live over mcp. Pick another name.",
					],
				},
			],
		});
	});

	test("a key that is a saved workflow's name as a slug lands on that workflow", async () => {
		const got = z
			.object({
				code: z.string(),
				workflows: z.array(z.object({ id: z.string(), key: z.string() })),
			})
			.parse(
				body(
					await call("get_workflow", {
						repo: "mcp-api",
						workflow: "mcp-live",
					}),
				),
			);
		expect(got.workflows).toEqual([{ id: "mcp-live", key: "live-over-mcp" }]);
		expect(got.code).toContain('\t"live-over-mcp": liveOverMcp(),');
		const checked = await call("validate_workflow", {
			repo: "mcp-api",
			definitions: [
				{
					...definition,
					id: "live-over-mcp",
					name: "live over mcp",
					nodes: definition.nodes.filter((node) => node.id !== "hook"),
					edges: definition.edges.filter((edge) => edge.to !== "hook"),
				},
			],
		});
		expect(body(checked)).toMatchObject({
			workflows: [{ id: "mcp-live", enabled: true }],
		});
	});

	test("get returns the workflow as code without secrets", async () => {
		const result = await call("get_workflow", {
			repo: "mcp-api",
			workflow: "mcp-as-code",
		});
		const parsed = z
			.object({ code: z.string(), workflows: z.array(z.unknown()) })
			.parse(body(result));
		expect(parsed.code).toContain('check("account-age", {');
		expect(parsed.code).toContain("webhook().after(accountAge.fails)");
		expect(parsed.code).not.toContain("internal.example");
		expect(parsed.workflows).toHaveLength(1);
	});
});

describe("live agent work", () => {
	const body = (result: { content: { text?: string }[] }) =>
		z.json().parse(JSON.parse(result.content[0]?.text ?? "null"));
	const stale = {
		id: "mcp-close-stale",
		name: "Close stale PRs",
		version: 1,
		nodes: [
			{
				id: "every-12h",
				type: "trigger",
				kinds: ["schedule.matched"],
				schedule: {
					every: { n: 12, unit: "hours" },
					match: {
						subjects: ["change-request"],
						state: "open",
						inactiveFor: { n: 14, unit: "days" },
					},
				},
			},
			{ id: "close", type: "action", action: "close" },
		],
		edges: [{ id: "e1", from: "every-12h", to: "close" }],
	};
	const repoId = () => (repoRows[1] ?? never()).id;

	test("validate keeps the workflow as a draft the user can open, and saves nothing", async () => {
		const result = await call("validate_workflow", {
			repo: "mcp-web",
			definitions: [stale],
		});
		expect(result.isError).toBeFalsy();
		expect(body(result)).toMatchObject({
			drafts: [{ id: "mcp-close-stale" }],
		});
		const cards = await agentWorkServices.listWorkflowCards(db, {
			repoId: repoId(),
		});
		const card = cards.find((entry) => entry.name === "Close stale PRs");
		expect(card?.draftId).not.toBeNull();
		expect(card?.enabled).toBe(false);
		expect(
			(await workflowServices.listWorkflows(db, repoId())).map((w) => w.name),
		).not.toContain("Close stale PRs");
		const touched = liveNodeTouches(card?.work, new Date());
		expect([...touched.keys()].sort()).toEqual(["close", "every-12h"]);
	});

	test("finish releases every node at once and keeps the draft", async () => {
		const result = await call("finish_workflow_work", {
			repo: "mcp-web",
			workflow: "mcp-close-stale",
		});
		expect(body(result)).toEqual({ released: 1 });
		const work = await agentWorkServices.getWorkflowWork(db, {
			repoId: repoId(),
			definitionId: "mcp-close-stale",
		});
		expect(liveNodeTouches(work, new Date()).size).toBe(0);
		expect(work.draft?.status).toBe("open");
	});

	test("apply saves it off and promotes the draft", async () => {
		const result = await call("apply_workflow", {
			repo: "mcp-web",
			definitions: [stale],
		});
		expect(body(result)).toMatchObject({
			workflows: [
				{ id: "mcp-close-stale", outcome: "created", enabled: false },
			],
		});
		const work = await agentWorkServices.getWorkflowWork(db, {
			repoId: repoId(),
			definitionId: "mcp-close-stale",
		});
		expect(work.draft?.status).toBe("promoted");
	});

	test("begin opens an empty draft and hands back the id to write with", async () => {
		const result = await call("begin_workflow_work", {
			repo: "mcp-web",
			name: "Label first-time contributors",
		});
		const begun = z
			.object({
				definitionId: z.string(),
				draftId: z.string(),
				url: z.string(),
			})
			.parse(body(result));
		expect(begun.url).toContain(`/workflows/${begun.draftId}`);
		const detail = await agentWorkServices.getWorkflowWithWork(db, {
			repoId: repoId(),
			workflowId: begun.draftId,
		});
		expect(detail?.name).toBe("Label first-time contributors");
		expect(detail?.work?.agents).toHaveLength(1);
	});

	test("a read-only agent validates without leaving a draft", async () => {
		const id = await orgId();
		const server = new McpServer({ name: "tripwire-test", version: "0.0.0" });
		registerTools(
			server,
			{
				db,
				pool,
				getBoss: () => Promise.reject(new Error("no queue in tests")),
				config,
				agent: {
					userId: USER_ID,
					clientId: "read-only-client",
					scopes: ["tripwire:read"],
					orgIds: id ? [id] : [],
				},
				accessDenied: null,
			},
			{ scopes: ["tripwire:read"], readOnly: true },
		);
		const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
		await server.connect(serverSide);
		const reader = new Client({ name: "reader", version: "0.0.0" });
		await reader.connect(clientSide);
		clients.push(reader);
		const tools = await reader.listTools();
		expect(tools.tools.map((tool) => tool.name)).not.toContain(
			"begin_workflow_work",
		);
		const result = textSchema.parse(
			await reader.callTool({
				name: "validate_workflow",
				arguments: {
					repo: "mcp-web",
					definitions: [{ ...stale, id: "read-only-check" }],
				},
			}),
		);
		expect(result.isError).toBeFalsy();
		expect(body(result)).not.toHaveProperty("drafts");
		const work = await agentWorkServices.getWorkflowWork(db, {
			repoId: repoId(),
			definitionId: "read-only-check",
		});
		expect(work.draft).toBeNull();
	});
});

describe("workflow push review", () => {
	const body = (result: { content: { text?: string }[] }) =>
		JSON.parse(result.content[0]?.text ?? "null");
	const reviewed = {
		id: "mcp-reviewed",
		name: "reviewed over mcp",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{
				id: "age",
				type: "rule",
				ref: "account-age@1",
				config: { minDays: 7 },
			},
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "age" },
			{ id: "e2", from: "age", to: "block", when: "fail" },
		],
	};

	test("a proposal saves nothing and links to its review page", async () => {
		const result = await call("propose_workflow_push", {
			repo: "mcp-web",
			definitions: [reviewed],
		});
		const parsed = workflowPushProposalResultSchema.parse(body(result));
		if (parsed.result !== "proposed") {
			throw new Error(`expected a proposal, got ${parsed.result}`);
		}
		expect(parsed.push).toMatchObject({
			org: orgSlug,
			repo: fullNames[1],
			status: "pending",
			workflows: [{ id: "mcp-reviewed", change: "new" }],
		});
		expect(parsed.push.url).toBe(
			`http://localhost:3420/${orgSlug}/mcp-web/workflows/review/${parsed.push.id}`,
		);
		const rows = await workflowServices.listWorkflowRows(
			db,
			repoRows[1]?.id ?? never(),
		);
		expect(rows.some((row) => row.definition.id === "mcp-reviewed")).toBe(
			false,
		);
	});

	test("get waits for the decision and returns each outcome", async () => {
		const proposed = workflowPushProposalResultSchema.parse(
			body(
				await call("propose_workflow_push", {
					repo: "mcp-web",
					definitions: [reviewed],
				}),
			),
		);
		if (proposed.result !== "proposed") {
			throw new Error("expected a proposal");
		}
		const pushId = proposed.push.id;
		const waiting = call("get_workflow_push", { push: pushId, waitSeconds: 5 });
		await new Promise((done) => setTimeout(done, 300));
		const decided = await workflowPushServices.decideWorkflowPush(db, {
			orgId: (await orgId()) ?? never(),
			pushId,
			userId: USER_ID,
			decision: "accept",
		});
		expect(decided.ok).toBe(true);
		const view = workflowPushViewSchema.parse(body(await waiting));
		expect(view.status).toBe("accepted");
		expect(view.workflows[0]).toMatchObject({
			id: "mcp-reviewed",
			outcome: "created",
			url: expect.stringContaining(`/${orgSlug}/mcp-web/workflows/`),
		});
		const again = await call("propose_workflow_push", {
			repo: "mcp-web",
			definitions: [reviewed],
		});
		expect(body(again)).toEqual({ result: "unchanged" });
	});

	test("an unknown push is an error", async () => {
		const result = await call("get_workflow_push", {
			push: "019f0000-0000-7000-8000-000000000000",
		});
		expect(result.isError).toBe(true);
	});
});

describe("custom rules", () => {
	const { intoRelease, fromReleasePlease } = RELEASE_EXAMPLE;
	const savedSchema = z.object({
		saved: z.literal(true),
		created: z.boolean(),
		id: z.string(),
		ref: z.string(),
		name: z.string(),
		enabled: z.boolean(),
		sentence: z.string(),
		use: z.string(),
		url: z.string(),
	});
	const json = (result: { content: { text?: string }[] }) =>
		JSON.parse(result.content[0]?.text ?? "null");
	let intoId = "";
	let fromId = "";
	const customId = z.templateLiteral(["custom-", z.string()]);

	test("save creates a rule that starts off and answers with its sentence", async () => {
		const result = await call("save_custom_rule", {
			repo: "mcp-api",
			name: "Not into release",
			description: "Only release-please opens change requests into release.",
			definition: intoRelease,
		});
		expect(result.isError).toBeFalsy();
		const saved = savedSchema.parse(json(result));
		expect(saved.id).toMatch(/^custom-not-into-release-[0-9a-f]{6}$/);
		expect(saved).toMatchObject({
			created: true,
			enabled: false,
			ref: `${saved.id}@1`,
			sentence: "require that target branch is not release",
			use: `customCheck("${saved.id}")`,
			url: `http://localhost:3420/${orgSlug}/mcp-api/rules`,
		});
		intoId = saved.id;
	});

	test("get_repo_rules lists it with its sentence, description and definition", async () => {
		const result = await call("get_repo_rules", { repo: "mcp-api" });
		const rules = z
			.array(z.looseObject({ ruleId: z.string() }))
			.parse(json(result));
		expect(rules.find((rule) => rule.ruleId === intoId)).toMatchObject({
			source: "custom",
			enabled: false,
			sentence: "require that target branch is not release",
			description: "Only release-please opens change requests into release.",
			definition: intoRelease,
			usedBy: [],
		});
	});

	test("a bad definition is refused with the reason, and nothing is saved", async () => {
		const result = await call("save_custom_rule", {
			repo: "mcp-api",
			name: "Broken",
			definition: {
				when: { id: "pr.targetBranch" },
				comparison: { kind: "over", args: [3] },
			},
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe("over does not apply to this signal");
		const listed = await call("get_repo_rules", { repo: "mcp-api" });
		expect(JSON.stringify(json(listed))).not.toContain("Broken");
	});

	test("a taken name is refused", async () => {
		const result = await call("save_custom_rule", {
			repo: "mcp-api",
			name: "not into release",
			definition: intoRelease,
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe(
			"A rule named not into release already exists on this repo. Pick another name.",
		);
	});

	test("the release example in the tool description saves, validates and applies", async () => {
		const second = savedSchema.parse(
			json(
				await call("save_custom_rule", {
					repo: "mcp-api",
					name: "From release-please",
					definition: fromReleasePlease,
				}),
			),
		);
		expect(second.sentence).toBe(
			"require that source branch starts with release-please",
		);
		fromId = second.id;
		const { allOf, block, customCheck, workflow, workflows } =
			workflowAuthoring;
		const compiled = compileWorkflows(
			workflows({
				"release-branch": workflow({
					name: "Release branch",
					on: "change-request.opened",
					check: allOf(
						customCheck(customId.parse(intoId)).fails,
						customCheck(customId.parse(fromId)).fails,
					),
					pass: [block()],
				}),
			}),
		);
		if (!compiled.ok) {
			throw new Error("the documented example does not compile");
		}
		const definitions = z.json().parse(compiled.definitions);
		const validated = await call("validate_workflow", {
			repo: "mcp-api",
			definitions,
		});
		expect(json(validated)).toMatchObject({
			workflows: [{ valid: true, issues: [] }],
		});
		const applied = await call("apply_workflow", {
			repo: "mcp-api",
			definitions,
		});
		expect(json(applied)).toMatchObject({
			workflows: [{ outcome: "created", enabled: false }],
		});
	});

	test("delete is refused while a workflow uses the rule", async () => {
		const result = await call("delete_custom_rule", {
			repo: "mcp-api",
			id: intoId,
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe(
			"This rule is used in Release branch. Remove it from those workflows before you delete it.",
		);
	});

	test("set_rule turns a custom rule on, and refuses settings for it", async () => {
		const unused = savedSchema.parse(
			json(
				await call("save_custom_rule", {
					repo: "mcp-api",
					name: "Small changes",
					definition: {
						when: { id: "pr.filesChanged" },
						comparison: { kind: "atMost", args: [50] },
					},
				}),
			),
		);
		const on = await call("set_rule", {
			repo: "mcp-api",
			ruleId: unused.id,
			enabled: true,
		});
		expect(json(on)).toEqual({
			saved: true,
			ruleId: unused.id,
			enabled: true,
			sentence: "require that files changed is at most 50",
		});
		const settings = await call("set_rule", {
			repo: "mcp-api",
			ruleId: unused.id,
			config: { max: 3 },
		});
		expect(settings.isError).toBe(true);
		const deleted = await call("delete_custom_rule", {
			repo: "mcp-api",
			id: unused.id,
		});
		expect(json(deleted)).toEqual({
			deleted: true,
			id: unused.id,
			repo: fullNames[0],
		});
	});

	test("an update keeps the id and an unknown id hints at get_repo_rules", async () => {
		const updated = savedSchema.parse(
			json(
				await call("save_custom_rule", {
					repo: "mcp-api",
					id: fromId,
					name: "From release-please",
					definition: {
						when: { id: "pr.sourceBranch" },
						comparison: {
							kind: "oneOf",
							args: [
								[
									"release-please--branches--release",
									"release-please--branches--release--components--crm",
								],
							],
						},
					},
				}),
			),
		);
		expect(updated).toMatchObject({ id: fromId, created: false });
		const missing = await call("save_custom_rule", {
			repo: "mcp-api",
			id: "custom-missing-000000",
			name: "Missing",
			definition: intoRelease,
		});
		expect(missing.isError).toBe(true);
		expect(missing.content[0]?.text).toBe(
			"No custom rule custom-missing-000000 on this repo. Call get_repo_rules to see the repo's rules.",
		);
	});
});
