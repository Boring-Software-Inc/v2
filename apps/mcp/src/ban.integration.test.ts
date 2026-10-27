import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	agentServices,
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	DEMO_EMAIL_DOMAIN,
	schema,
	staffUserServices,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import type { Pool } from "pg";
import pino from "pino";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import type { TokenCheck } from "./token.ts";

const config = readConfig({
	BETTER_AUTH_SECRET: "test-secret",
	APP_URL: "http://localhost:3420",
	MCP_PUBLIC_URL: "http://localhost:3421/mcp",
});

let container: TestDatabase;
let db: Db;
let pool: Pool;

async function seedAgentUser(): Promise<{ userId: string; clientId: string }> {
	const userId = generateId();
	await db.insert(schema.user).values({
		id: userId,
		name: "spammer",
		email: `${userId}@${DEMO_EMAIL_DOMAIN}`,
		accessStatus: "approved",
	});
	const clientId = `client-${userId}`;
	await db.insert(schema.oauthClient).values({
		id: generateId(),
		clientId,
		name: "Claude Code",
		redirectUris: ["http://127.0.0.1:7777/callback"],
	});
	await agentServices.saveAgentGrant(db, { userId, clientId, orgIds: [] });
	return { userId, clientId };
}

function appFor(agent: { userId: string; clientId: string }) {
	return createApp({
		db,
		pool,
		getBoss: () => Promise.reject(new Error("no queue in tests")),
		config,
		logger: pino({ level: "silent" }),
		verifyToken: async (): Promise<TokenCheck> => ({
			ok: true,
			agent: { ...agent, scopes: ["tripwire:read"], orgIds: [] },
		}),
	});
}

function listTools(app: ReturnType<typeof createApp>) {
	return app.request("http://localhost:3421/mcp", {
		method: "POST",
		headers: {
			authorization: "Bearer surviving-token",
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
	});
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("mcp initialization", () => {
	test("advertises the released server version", async () => {
		const agent = await seedAgentUser();
		const res = await appFor(agent).request("http://localhost:3421/mcp", {
			method: "POST",
			headers: {
				authorization: "Bearer surviving-token",
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "release-test", version: "1.0.0" },
				},
			}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: { serverInfo: { name: "tripwire", version: "1.1.0" } },
		});
	});
});

describe("a banned user's agent", () => {
	test("a token that outlives the ban is refused at the MCP boundary", async () => {
		const agent = await seedAgentUser();
		await staffUserServices.banUser(db, {
			userId: agent.userId,
			reason: "Abuse",
			expires: null,
		});
		await agentServices.saveAgentGrant(db, { ...agent, orgIds: [] });
		const res = await listTools(appFor(agent));
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toContain("invalid_token");
	});

	test("a ban that has ended lets the agent back in", async () => {
		const agent = await seedAgentUser();
		await staffUserServices.banUser(db, {
			userId: agent.userId,
			reason: "Cooldown",
			expires: new Date(Date.now() - 1000),
		});
		await agentServices.saveAgentGrant(db, { ...agent, orgIds: [] });
		const res = await listTools(appFor(agent));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "whoami" }),
				]),
			},
		});
	});
});
