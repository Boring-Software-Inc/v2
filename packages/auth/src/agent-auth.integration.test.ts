import { afterAll, beforeAll, expect, test } from "bun:test";
import { AGENT_ORGS_CLAIM, TRIPWIRE_CLI_CLIENT_ID } from "@tripwire/contracts";
import {
	agentServices,
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "@tripwire/db";
import { createAuth } from "./server.ts";

const BASE = "http://localhost:3000";
const RESOURCE = "http://localhost:3421/mcp";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

function form(body: Record<string, string>) {
	return {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	};
}

test("the cli device grant mints an audience-bound jwt that carries the granted orgs", async () => {
	const auth = createAuth({
		db,
		secret: "test-secret-please-ignore-0123456789",
		baseUrl: BASE,
		github: null,
		opengit: null,
		devLogin: true,
		mcpResource: RESOURCE,
	});
	const handle = (path: string, init?: RequestInit) =>
		auth.handler(new Request(`${BASE}/api/auth${path}`, init));

	const signUp = await auth.api.signUpEmail({
		body: {
			email: "agent@tripwire.demo",
			password: "agent-password-1",
			name: "agent",
		},
		asResponse: true,
	});
	const cookie = cookieHeader(signUp);
	const session = await auth.api.getSession({
		headers: new Headers({ cookie }),
	});
	const userId = session?.user.id ?? "";

	const codeRes = await handle(
		"/device/code",
		form({
			client_id: TRIPWIRE_CLI_CLIENT_ID,
			scope: "openid offline_access tripwire:read",
			resource: RESOURCE,
		}),
	);
	expect(codeRes.status).toBe(200);
	const code = (await codeRes.json()) as {
		device_code: string;
		user_code: string;
		verification_uri: string;
	};
	expect(code.verification_uri).toContain("/device");

	const pending = await handle(
		"/oauth2/token",
		form({
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: code.device_code,
			client_id: TRIPWIRE_CLI_CLIENT_ID,
		}),
	);
	expect(((await pending.json()) as { error: string }).error).toBe(
		"authorization_pending",
	);

	const verify = await handle(`/device?user_code=${code.user_code}`, {
		headers: { cookie },
	});
	expect(verify.status).toBe(200);
	await agentServices.saveAgentGrant(db, {
		userId,
		clientId: TRIPWIRE_CLI_CLIENT_ID,
		orgIds: ["org-a"],
	});
	const approve = await handle("/device/approve", {
		method: "POST",
		headers: { cookie, "content-type": "application/json", origin: BASE },
		body: JSON.stringify({ userCode: code.user_code }),
	});
	expect(approve.status).toBe(200);

	await new Promise((resolve) => setTimeout(resolve, 5100));
	const tokenRes = await handle(
		"/oauth2/token",
		form({
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: code.device_code,
			client_id: TRIPWIRE_CLI_CLIENT_ID,
		}),
	);
	const tokens = (await tokenRes.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};
	expect(tokenRes.status).toBe(200);
	expect(tokens.expires_in).toBeLessThanOrEqual(900);
	expect(tokens.refresh_token).toBeString();
	const claims = JSON.parse(
		Buffer.from(
			tokens.access_token.split(".")[1] ?? "",
			"base64url",
		).toString(),
	) as Record<string, unknown>;
	expect(claims.aud).toContain(RESOURCE);
	expect(claims.azp).toBe(TRIPWIRE_CLI_CLIENT_ID);
	expect(claims.sub).toBe(userId);
	expect(claims[AGENT_ORGS_CLAIM]).toEqual(["org-a"]);

	const jwksRes = await handle("/jwks");
	expect(jwksRes.status).toBe(200);
	const keys = (await jwksRes.json()) as { keys: unknown[] };
	expect(keys.keys.length).toBeGreaterThan(0);

	await agentServices.revokeAgent(db, {
		userId,
		clientId: TRIPWIRE_CLI_CLIENT_ID,
	});
	const refreshed = await handle(
		"/oauth2/token",
		form({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token ?? "",
			client_id: TRIPWIRE_CLI_CLIENT_ID,
		}),
	);
	expect(refreshed.status).toBe(400);
}, 60_000);
