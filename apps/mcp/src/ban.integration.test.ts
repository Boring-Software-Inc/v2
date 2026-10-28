import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
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
import { eq } from "drizzle-orm";
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
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let previousAccessGate: string | undefined;
let flagRequests = 0;

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
	previousAccessGate = process.env.ACCESS_GATE_ENABLED;
	process.env.ACCESS_GATE_ENABLED = "true";
	const originalFetch = globalThis.fetch;
	/** Synthetic outage keeps real auth checks independent of the flag service. */
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const url = new URL(
					input instanceof Request ? input.url : String(input),
				);
				const method =
					init?.method ?? (input instanceof Request ? input.method : "GET");
				if (
					url.origin === "https://api.databuddy.cc" &&
					url.pathname === "/public/v1/flags/bulk" &&
					method.toUpperCase() === "GET"
				) {
					flagRequests++;
					return Promise.resolve(new Response(null, { status: 503 }));
				}
				return originalFetch(input, init);
			},
			{ preconnect: originalFetch.preconnect },
		),
	);
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	fetchSpy?.mockRestore();
	if (previousAccessGate === undefined) {
		delete process.env.ACCESS_GATE_ENABLED;
	} else {
		process.env.ACCESS_GATE_ENABLED = previousAccessGate;
	}
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("mcp initialization", () => {
	test("advertises the released server version", async () => {
		const previousFlagRequests = flagRequests;
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
		expect(flagRequests).toBeGreaterThan(previousFlagRequests);
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
		const previousFlagRequests = flagRequests;
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
		expect(flagRequests).toBeGreaterThan(previousFlagRequests);
	});
});

describe("access gate during a flags service failure", () => {
	test("unrelated external requests retain the original fetch behavior", async () => {
		const controller = new AbortController();
		const reason = new Error("Unrelated request was already aborted");
		controller.abort(reason);
		const previousFlagRequests = flagRequests;
		for (const input of [
			"https://example.com/public/v1/flags/bulk",
			new URL("https://api.databuddy.cc/unrelated"),
			new Request("https://api.databuddy.cc/public/v1/flags/bulk", {
				method: "POST",
			}),
		]) {
			await expect(fetch(input, { signal: controller.signal })).rejects.toBe(
				reason,
			);
		}
		expect(flagRequests).toBe(previousFlagRequests);
	});

	test.each([
		"pending",
		"rejected",
	] as const)("a %s user is still refused by the real MCP middleware", async (accessStatus) => {
		const agent = await seedAgentUser();
		await db
			.update(schema.user)
			.set({ accessStatus })
			.where(eq(schema.user.id, agent.userId));
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
				method: "tools/call",
				params: { name: "setup_status", arguments: { org: "ungranted" } },
			}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				isError: true,
				structuredContent: {
					error:
						"Your Tripwire access is not approved yet. Request access at http://localhost:3420/queue and try again once you are in.",
				},
			},
		});
	});
});
