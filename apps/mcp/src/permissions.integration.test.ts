import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JsonValue } from "@tripwire/contracts";
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
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { and, eq } from "drizzle-orm";
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
});

let container: TestDatabase;
let db: Db;
let pool: Pool;
let orgSlug: string;
let orgId: string;
const clients: Client[] = [];

async function addUser(id: string): Promise<void> {
	await db
		.insert(schema.user)
		.values({ id, name: id, email: `${id}@${DEMO_EMAIL_DOMAIN}` })
		.onConflictDoNothing();
}

async function connect(userId: string): Promise<Client> {
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
				clientId: `client-${userId}`,
				scopes: [...SCOPES],
				orgIds: [orgId],
			},
			accessDenied: null,
		},
		{ scopes: [...SCOPES], readOnly: false },
	);
	const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	const client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(clientSide);
	clients.push(client);
	return client;
}

async function call(
	client: Client,
	name: string,
	args: Record<string, JsonValue>,
) {
	return textSchema.parse(await client.callTool({ name, arguments: args }));
}

const WORKFLOW: JsonValue = {
	id: "perm-wf",
	name: "Permissions",
	version: 1,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "x", type: "action", action: "block" },
	],
	edges: [{ id: "e", from: "t", to: "x" }],
};

let member: Client;
let builder: Client;
let reviewer: Client;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	for (const id of [
		"perm-admin",
		"perm-member",
		"perm-builder",
		"perm-reviewer",
	]) {
		await addUser(id);
	}
	const org = await ensureTeamOrg(db, {
		adminUserId: "perm-admin",
		memberUserIds: ["perm-member", "perm-builder", "perm-reviewer"],
	});
	orgSlug = org.slug;
	orgId = org.id;
	await ensureDemoRepo(db, "perm-api", { installationId: "perm-inst" });
	await orgServices.linkOrgInstallation(db, {
		orgId,
		installationId: "perm-inst",
	});
	await db.insert(schema.organizationRole).values({
		id: generateId(),
		organizationId: orgId,
		role: "builder",
		permission: JSON.stringify({ workflows: ["read", "manage"] }),
	});
	await db
		.update(schema.member)
		.set({ role: "builder" })
		.where(
			and(
				eq(schema.member.organizationId, orgId),
				eq(schema.member.userId, "perm-builder"),
			),
		);
	await db.insert(schema.organizationRole).values({
		id: generateId(),
		organizationId: orgId,
		role: "reviewer",
		permission: JSON.stringify({ moderation: ["read", "manage"] }),
	});
	await db
		.update(schema.member)
		.set({ role: "reviewer" })
		.where(
			and(
				eq(schema.member.organizationId, orgId),
				eq(schema.member.userId, "perm-reviewer"),
			),
		);
	member = await connect("perm-member");
	builder = await connect("perm-builder");
	reviewer = await connect("perm-reviewer");
}, 120_000);

afterAll(async () => {
	for (const client of clients) {
		await client.close().catch(() => undefined);
	}
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("MCP writes follow the org's role scopes", () => {
	test("a plain member cannot apply a workflow", async () => {
		const result = await call(member, "apply_workflow", {
			org: orgSlug,
			repo: "perm-api",
			definitions: [WORKFLOW],
		});
		expect(result.isError).toBe(true);
	});

	test("a custom role with workflows manage can apply a workflow", async () => {
		const result = await call(builder, "apply_workflow", {
			org: orgSlug,
			repo: "perm-api",
			definitions: [WORKFLOW],
		});
		expect(result.isError).toBeFalsy();
	});

	test("workflows manage does not grant rules manage", async () => {
		const result = await call(builder, "set_rule", {
			org: orgSlug,
			repo: "perm-api",
			ruleId: "account-age",
			enabled: false,
		});
		expect(result.isError).toBe(true);
	});

	test("a plain member cannot turn a workflow on", async () => {
		const result = await call(member, "set_workflow_enabled", {
			org: orgSlug,
			repo: "perm-api",
			workflowId: "missing",
			enabled: true,
		});
		expect(result.isError).toBe(true);
	});
});

describe("MCP reads follow the org's role scopes", () => {
	const outside: [string, Record<string, JsonValue>][] = [
		["get_repo_rules", { repo: "perm-api" }],
		["list_workflows", { repo: "perm-api" }],
		["get_workflow", { repo: "perm-api" }],
		["validate_workflow", { repo: "perm-api", definitions: [WORKFLOW] }],
		["list_runs", {}],
		["get_run", { runId: "019f0000-0000-7000-8000-000000000000" }],
	];

	for (const [tool, args] of outside) {
		test(`a moderation-only role cannot call ${tool}`, async () => {
			const result = await call(reviewer, tool, { org: orgSlug, ...args });
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("Your role in");
		});
	}

	test("a moderation-only role reads the human review queue", async () => {
		const result = await call(reviewer, "list_moderation_queue", {
			org: orgSlug,
		});
		expect(result.isError).toBeFalsy();
	});

	test("a workflows-only role cannot read the human review queue", async () => {
		const result = await call(builder, "list_moderation_queue", {
			org: orgSlug,
		});
		expect(result.isError).toBe(true);
	});

	test("the org shell stays open to every role", async () => {
		for (const tool of ["setup_status", "list_repos"]) {
			const result = await call(reviewer, tool, { org: orgSlug });
			expect(result.isError).toBeFalsy();
		}
	});
});
