import { describe, expect, test } from "bun:test";
import { DEVICE_CODE_GRANT_TYPE } from "@better-auth/oauth-provider";
import { TRIPWIRE_CLI_CLIENT_ID } from "@tripwire/contracts";
import { createDb } from "@tripwire/db";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
	agentAuthPlugins,
	agentRateLimitRules,
	oauthTokenRateLimit,
} from "./agent-auth.ts";

const BASE = "http://localhost:3000";
const RULE = { window: 60, max: 20 };

function tokenRequest(body: Record<string, string>, json = false): Request {
	return new Request(`${BASE}/api/auth/oauth2/token`, {
		method: "POST",
		headers: {
			"content-type": json
				? "application/json"
				: "application/x-www-form-urlencoded",
		},
		body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
	});
}

describe("oauthTokenRateLimit", () => {
	test("exempts device code polling from the per-ip limiter", async () => {
		expect(
			await oauthTokenRateLimit(
				tokenRequest({ grant_type: DEVICE_CODE_GRANT_TYPE }),
				RULE,
			),
		).toBe(false);
	});

	test("keeps the limiter on every other grant", async () => {
		for (const grant of ["authorization_code", "refresh_token", ""]) {
			expect(
				await oauthTokenRateLimit(tokenRequest({ grant_type: grant }), RULE),
			).toEqual(RULE);
		}
		expect(
			await oauthTokenRateLimit(
				tokenRequest({ grant_type: DEVICE_CODE_GRANT_TYPE }, true),
				RULE,
			),
		).toEqual(RULE);
	});

	test("leaves the body readable for the handler", async () => {
		const request = tokenRequest({ grant_type: DEVICE_CODE_GRANT_TYPE });
		await oauthTokenRateLimit(request, RULE);
		expect(await request.text()).toContain("device_code");
	});
});

describe("token endpoint with rate limiting on", () => {
	const auth = betterAuth({
		database: memoryAdapter(
			Object.fromEntries(
				[
					"user",
					"session",
					"account",
					"verification",
					"jwks",
					"oauthClient",
					"oauthResource",
					"oauthClientResource",
					"oauthRefreshToken",
					"oauthAccessToken",
					"oauthConsent",
					"oauthClientAssertion",
					"deviceCode",
				].map((model) => [model, []]),
			),
		),
		secret: "test-secret-please-ignore-0123456789",
		baseURL: BASE,
		rateLimit: {
			enabled: true,
			storage: "memory",
			customRules: agentRateLimitRules,
		},
		plugins: agentAuthPlugins({
			db: createDb("postgres://tripwire@127.0.0.1:1/unused").db,
		}),
	});
	const post = (body: Record<string, string>) =>
		auth.handler(tokenRequest(body));

	test("device polling for the whole code lifetime never gets 429", async () => {
		const statuses = new Set<number>();
		for (let poll = 0; poll < 130; poll++) {
			const res = await post({
				grant_type: DEVICE_CODE_GRANT_TYPE,
				device_code: "unknown-device-code",
				client_id: TRIPWIRE_CLI_CLIENT_ID,
			});
			statuses.add(res.status);
		}
		expect(statuses.has(429)).toBe(false);
	});

	test("other grants still hit the limit", async () => {
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 25; attempt++) {
			const res = await post({
				grant_type: "refresh_token",
				refresh_token: "unknown-refresh-token",
				client_id: TRIPWIRE_CLI_CLIENT_ID,
			});
			statuses.push(res.status);
		}
		expect(statuses.slice(0, 20)).not.toContain(429);
		expect(statuses.slice(20)).toEqual([429, 429, 429, 429, 429]);
	});
});
