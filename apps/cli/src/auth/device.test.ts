import { describe, expect, test } from "bun:test";
import {
	type AuthDeps,
	AuthUnreachableError,
	DEVICE_GRANT,
	pollForToken,
	refreshCredential,
	requestDeviceCode,
	SessionExpiredError,
} from "#/auth/device";

const AUTH = "https://app.tripwire.sh/api/auth";
const MCP = "https://mcp.tripwire.sh/mcp";

interface Recorded {
	url: string;
	form: URLSearchParams;
}

function fakeDeps(
	responses: Array<[number, string]>,
): AuthDeps & { requests: Recorded[]; slept: number[] } {
	const requests: Recorded[] = [];
	const slept: number[] = [];
	let clock = 0;
	return {
		requests,
		slept,
		fetch: async (url, init) => {
			requests.push({ url, form: new URLSearchParams(String(init.body)) });
			const next = responses.shift();
			if (!next) throw new Error("no more responses");
			return new Response(next[1], { status: next[0] });
		},
		sleep: async (ms) => {
			slept.push(ms);
			clock += ms;
		},
		now: () => clock,
	};
}

describe("device grant", () => {
	test("requests a code for the public client and the MCP resource", async () => {
		const deps = fakeDeps([
			[
				200,
				JSON.stringify({
					device_code: "dev",
					user_code: "ABCD-EFGH",
					verification_uri: "https://app.tripwire.sh/device",
					expires_in: 600,
					interval: 5,
				}),
			],
		]);
		const code = await requestDeviceCode(deps, AUTH, MCP);
		expect(code.user_code).toBe("ABCD-EFGH");
		expect(deps.requests[0]?.url).toBe(`${AUTH}/device/code`);
		expect(deps.requests[0]?.form.get("client_id")).toBe("tripwire-cli");
		expect(deps.requests[0]?.form.get("resource")).toBe(MCP);
		expect(deps.requests[0]?.form.get("scope")).toContain("tripwire:read");
	});

	test("polls through pending and slow_down, then stores the token", async () => {
		const deps = fakeDeps([
			[400, JSON.stringify({ error: "authorization_pending" })],
			[400, JSON.stringify({ error: "slow_down" })],
			[
				200,
				JSON.stringify({
					access_token: "at",
					refresh_token: "rt",
					expires_in: 900,
					token_type: "Bearer",
				}),
			],
		]);
		const credential = await pollForToken(deps, AUTH, MCP, {
			device_code: "dev",
			user_code: "U",
			verification_uri: "v",
			expires_in: 600,
			interval: 5,
		});
		expect(deps.slept).toEqual([5000, 5000, 10000]);
		expect(deps.requests.map((r) => r.form.get("grant_type"))).toEqual([
			DEVICE_GRANT,
			DEVICE_GRANT,
			DEVICE_GRANT,
		]);
		expect(deps.requests[0]?.url).toBe(`${AUTH}/oauth2/token`);
		expect(credential).toEqual({
			accessToken: "at",
			refreshToken: "rt",
			expiresAt: 20000 + 900_000,
			mcpUrl: MCP,
			authUrl: AUTH,
		});
	});

	test("stops on access_denied", async () => {
		const deps = fakeDeps([[400, JSON.stringify({ error: "access_denied" })]]);
		await expect(
			pollForToken(deps, AUTH, MCP, {
				device_code: "d",
				user_code: "u",
				verification_uri: "v",
				expires_in: 600,
			}),
		).rejects.toThrow("denied");
	});

	test("refresh keeps the old refresh token when none is returned", async () => {
		const deps = fakeDeps([
			[200, JSON.stringify({ access_token: "new", expires_in: 60 })],
		]);
		const fresh = await refreshCredential(deps, {
			accessToken: "old",
			refreshToken: "rt",
			mcpUrl: MCP,
			authUrl: AUTH,
		});
		expect(fresh.accessToken).toBe("new");
		expect(fresh.refreshToken).toBe("rt");
		expect(deps.requests[0]?.form.get("grant_type")).toBe("refresh_token");
	});
	describe("refresh failures", () => {
		const credential = {
			accessToken: "old",
			refreshToken: "rt",
			mcpUrl: MCP,
			authUrl: AUTH,
		};

		test("an OAuth 400 or 401 error means the session expired", async () => {
			for (const status of [400, 401]) {
				const deps = fakeDeps([
					[status, JSON.stringify({ error: "invalid_grant" })],
				]);
				await expect(
					refreshCredential(deps, credential),
				).rejects.toBeInstanceOf(SessionExpiredError);
			}
		});

		test("5xx, non-JSON bodies and network errors mean unreachable", async () => {
			const cases: Array<[number, string]> = [
				[
					503,
					JSON.stringify({
						error: { code: "err:frontline:capacity:no_running_instances" },
					}),
				],
				[502, "<html>bad gateway</html>"],
				[400, "not json"],
				[500, JSON.stringify({ error: "server_error" })],
			];
			for (const response of cases) {
				const deps = fakeDeps([response]);
				await expect(
					refreshCredential(deps, credential),
				).rejects.toBeInstanceOf(AuthUnreachableError);
			}
			const offline = fakeDeps([]);
			await expect(refreshCredential(offline, credential)).rejects.toThrow(
				"Tripwire is not reachable right now. Try again in a minute.",
			);
		});
	});
});
