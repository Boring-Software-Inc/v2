import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	DEMO_EMAIL_DOMAIN,
	ensureDemoRepo,
	ensureTeamOrg,
	orgServices,
	schema,
	seedRun,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import { z } from "zod";
import { readConfig } from "./config.ts";
import { registerTools } from "./tools.ts";

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

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	const userId = "mcp-tools-user";
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
	const server = new McpServer({ name: "tripwire-test", version: "0.0.0" });
	registerTools(
		server,
		{
			db,
			pool,
			getBoss: () => Promise.reject(new Error("no queue in tests")),
			config,
			agent: {
				userId,
				clientId: "test-client",
				scopes: [...SCOPES],
				orgIds: [org.id],
			},
			accessDenied: null,
		},
		{ scopes: [...SCOPES], readOnly: false },
	);
	const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(clientSide);
}, 120_000);

afterAll(async () => {
	await client?.close().catch(() => undefined);
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
			(step: { stepId: string }) => step.stepId === "run:unrunnable",
		);
		expect(unrunnable).toMatchObject({
			workflow: "Crypto or honeypot",
			outcome: "Could not run",
			kind: "gate",
			status: "skipped",
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

describe("tool errors", () => {
	test("keep tool names out of the message and put them in the hint", async () => {
		const result = await call("list_workflows", { repo: "scratch" });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			error: `No repo named scratch in ${orgSlug}.`,
			hint: "list_repos",
		});
		expect(result.content[0]?.text).toBe(
			`No repo named scratch in ${orgSlug}. Call list_repos to see the repos.`,
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
			valid: true,
			workflows: [
				{
					id: "mcp-as-code",
					valid: true,
					changes: [{ change: "added", subject: "workflow" }],
				},
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
