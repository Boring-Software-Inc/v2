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
