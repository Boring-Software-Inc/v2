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

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	for (const id of ["perm-admin", "perm-member", "perm-builder"]) {
		await addUser(id);
	}
	const org = await ensureTeamOrg(db, {
		adminUserId: "perm-admin",
		memberUserIds: ["perm-member", "perm-builder"],
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
	member = await connect("perm-member");
	builder = await connect("perm-builder");
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
