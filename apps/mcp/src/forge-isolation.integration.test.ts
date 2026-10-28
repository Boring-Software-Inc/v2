import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type AgentScope,
	DEFAULT_FORGE_ORIGIN,
	DEFAULT_WORKFLOW,
	forgeIdSchema,
	type JsonValue,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	ensureTeamOrg,
	orgServices,
	repoServices,
	runServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readConfig } from "./config.ts";
import { parseRepoRef } from "./context.ts";
import { registerTools } from "./tools.ts";

let database: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let client: Client;
let orgId: string;
let orgSlug: string;
let foreignRepoId: string;
let foreignRunId: string;
let foreignItemId: string;
let ownRepoId: string;
let ownRunId: string;
const userId = generateId();
const scopes: AgentScope[] = [
	"tripwire:read",
	"tripwire:configure",
	"tripwire:moderate",
];
const fullName = "same-owner/collision";
const resultSchema = z.object({
	isError: z.boolean().optional(),
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});

beforeAll(async () => {
	database = await createTestDatabase();
	({ db, pool } = createDb(database.url));
	await applyMigrations(db);
	await db
		.insert(schema.user)
		.values({ id: userId, name: "isolation", email: `${userId}@example.com` });
	const org = await ensureTeamOrg(db, {
		adminUserId: userId,
		memberUserIds: [],
	});
	orgId = org.id;
	orgSlug = org.slug;
	const foreignOrgId = generateId();
	await db
		.insert(schema.organization)
		.values({ id: foreignOrgId, name: "foreign", slug: foreignOrgId });
	for (const forge of ["github", "opengit"] as const) {
		const repoId = await repoServices.ensureRepo(db, {
			forge,
			externalId: "same-id",
			owner: "same-owner",
			name: "collision",
			fullName,
			private: true,
			orgId: forge === "github" ? orgId : foreignOrgId,
		});
		const eventId = generateId();
		await db.insert(schema.events).values({
			id: eventId,
			forge,
			deliveryId: eventId,
			rawKind: "database-isolation-test",
			raw: {},
			kind: "change-request.opened",
		});
		const runId = await runServices.createRun(db, {
			eventId,
			repoFullName: fullName,
			subjectNumber: 7,
			headSha: "same-head",
			snapshot: [DEFAULT_WORKFLOW],
			status: "paused",
			verdict: "needs_review",
		});
		const itemId = generateId();
		await db
			.insert(schema.moderationItems)
			.values({ id: itemId, runId, nodeId: "review" });
		if (forge === "github") {
			ownRepoId = repoId;
			ownRunId = runId;
		} else {
			foreignRepoId = repoId;
			foreignRunId = runId;
			foreignItemId = itemId;
		}
	}
	const server = new McpServer({ name: "isolation-test", version: "0.0.0" });
	registerTools(
		server,
		{
			db,
			pool,
			getBoss: () =>
				Promise.reject(new Error("a denied request must not reach the queue")),
			config: readConfig({
				BETTER_AUTH_SECRET: "test",
				APP_URL: "http://localhost:3420",
				MCP_PUBLIC_URL: "http://localhost:3421/mcp",
			}),
			agent: { userId, clientId: "test", scopes, orgIds: [orgId] },
			accessDenied: null,
		},
		{ scopes, readOnly: false },
	);
	const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(clientSide);
}, 120_000);

afterAll(async () => {
	await client?.close();
	await pool?.end();
	await database?.stop();
});

async function call(name: string, args: Record<string, JsonValue>) {
	return resultSchema.parse(
		await client.callTool({ name, arguments: { org: orgSlug, ...args } }),
	);
}

test("repository URLs retain forge identity, including GitCafe's distinct host", () => {
	for (const forge of forgeIdSchema.options) {
		const origin = DEFAULT_FORGE_ORIGIN[forge];
		expect(parseRepoRef(`${origin}/same-owner/collision.git`)).toEqual({
			forge,
			scope: "same-owner",
			name: "collision",
		});
	}
	for (const url of [
		"https://attacker.example/same-owner/collision",
		"https://gitcafe.com/same-owner/collision",
		"https://github.com/same-owner/collision/pulls/7",
		"https://github.com@attacker.example/same-owner/collision",
	]) {
		expect(() => parseRepoRef(url)).toThrow();
	}
});

test("run lists and direct run reads retain the permitted forge", async () => {
	const listed = await call("list_runs", {});
	expect(listed.isError).toBeFalsy();
	const runs = z
		.array(z.object({ id: z.string() }))
		.parse(JSON.parse(listed.content[0]?.text ?? ""));
	expect(runs.map((run) => run.id)).toEqual([ownRunId]);
	expect((await call("get_run", { runId: foreignRunId })).isError).toBe(true);
});

test("a same-name item from another forge cannot reach the decision queue", async () => {
	const result = await call("decide_moderation", {
		repo: `https://github.com/${fullName}`,
		itemId: foreignItemId,
		decision: "approve",
	});
	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toContain("No review item");
	const [item] = await db
		.select()
		.from(schema.moderationItems)
		.where(eq(schema.moderationItems.id, foreignItemId));
	expect(item?.status).toBe("pending");
});

test("a foreign forge URL cannot retarget a rule write onto the permitted repo", async () => {
	const result = await call("set_rule", {
		repo: `https://open-git.com/${fullName}`,
		ruleId: "account-age",
		enabled: true,
		config: { minDays: 30 },
	});
	expect(result.isError).toBe(true);
	expect(await repoServices.listRuleConfigs(db, ownRepoId)).toEqual([]);
});

test("one org can contain both forges, requiring a qualified target for duplicate names", async () => {
	await db
		.update(schema.repos)
		.set({ orgId })
		.where(eq(schema.repos.id, foreignRepoId));
	expect(
		await orgServices.getOrgRepo(db, { orgId, repoName: "collision" }),
	).toBeNull();
	expect((await call("list_workflows", { repo: "collision" })).isError).toBe(
		true,
	);
	expect(
		(await call("list_workflows", { repo: `https://github.com/${fullName}` }))
			.isError,
	).toBeFalsy();
	expect(
		(
			await call("list_workflows", {
				repo: `https://open-git.com/${fullName}`,
			})
		).isError,
	).toBeFalsy();
});

test("owner and Tripwire org interpretations cannot silently select different repos", async () => {
	const otherId = generateId();
	await db
		.insert(schema.organization)
		.values({ id: otherId, name: "Collision scope", slug: "collision-scope" });
	await db.insert(schema.member).values({
		id: generateId(),
		organizationId: otherId,
		userId,
		role: "admin",
	});
	const githubId = await repoServices.ensureRepo(db, {
		forge: "github",
		externalId: generateId(),
		owner: "collision-scope",
		name: "widget",
		fullName: "collision-scope/widget",
		orgId,
	});
	const openId = await repoServices.ensureRepo(db, {
		forge: "opengit",
		externalId: generateId(),
		owner: "different-owner",
		name: "widget",
		fullName: "different-owner/widget",
		orgId: otherId,
	});
	const server = new McpServer({ name: "collision-test", version: "0.0.0" });
	registerTools(
		server,
		{
			db,
			pool,
			getBoss: () => Promise.reject(new Error("unexpected queue")),
			config: readConfig({
				BETTER_AUTH_SECRET: "test",
				APP_URL: "http://localhost:3420",
				MCP_PUBLIC_URL: "http://localhost:3421/mcp",
			}),
			agent: { userId, clientId: "test", scopes, orgIds: [orgId, otherId] },
			accessDenied: null,
		},
		{ scopes, readOnly: false },
	);
	const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	const otherClient = new Client({ name: "test", version: "0.0.0" });
	await otherClient.connect(clientSide);
	const set = async (repo: string, org?: string) =>
		resultSchema.parse(
			await otherClient.callTool({
				name: "set_rule",
				arguments: {
					repo,
					org,
					ruleId: "account-age",
					enabled: true,
					config: { minDays: 30 },
				},
			}),
		);
	try {
		expect((await set("collision-scope/widget")).isError).toBe(true);
		expect(await repoServices.listRuleConfigs(db, githubId)).toEqual([]);
		expect(await repoServices.listRuleConfigs(db, openId)).toEqual([]);
		expect(
			(await set("https://github.com/Collision-Scope/widget")).isError,
		).toBeFalsy();
		expect((await repoServices.listRuleConfigs(db, githubId)).length).toBe(1);
		expect(
			(
				await set(
					"https://github.com/collision-scope/widget",
					"collision-scope",
				)
			).isError,
		).toBe(true);
		expect(
			(await set("https://github.com/collision-scope/widget", orgSlug)).isError,
		).toBeFalsy();
		expect(await repoServices.listRuleConfigs(db, openId)).toEqual([]);
		expect(
			(await set("https://open-git.com/Different-Owner/widget")).isError,
		).toBe(true);
		expect(
			(await set("http://localhost:3420/collision-scope/widget/rules")).isError,
		).toBeFalsy();
		expect((await repoServices.listRuleConfigs(db, openId)).length).toBe(1);
		await repoServices.ensureRepo(db, {
			forge: "github",
			externalId: generateId(),
			owner: "COLLISION-SCOPE",
			name: "widget",
			fullName: "COLLISION-SCOPE/widget",
			orgId,
		});
		expect(
			(await set("https://github.com/Collision-Scope/widget", orgSlug)).isError,
		).toBe(true);
	} finally {
		await otherClient.close();
	}
});
