import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Credential, credentialStore } from "#/auth/credentials";
import { type AuthDeps, AuthUnreachableError } from "#/auth/device";
import { loadSession, NotSignedInError } from "#/auth/session";
import { realSystem, type System } from "#/system";
import { makeSandbox, type Sandbox } from "../../test/sandbox";

const CREDENTIAL: Credential = {
	accessToken: "old-access",
	refreshToken: "refresh",
	expiresAt: 1000,
	mcpUrl: "https://mcp.tripwire.sh/mcp",
	authUrl: "https://app.tripwire.sh/api/auth",
};

let sandbox: Sandbox;
let system: System;
let deps: AuthDeps;

beforeEach(async () => {
	sandbox = makeSandbox();
	system = realSystem(sandbox.env, "linux");
	deps = {
		fetch: async () => {
			throw new Error("unexpected fetch");
		},
		sleep: async () => {},
		now: () => 1000,
	};
	await credentialStore(system).write(CREDENTIAL);
});

afterEach(() => sandbox.cleanup());

describe("loadSession", () => {
	test("refreshes and persists a valid token", async () => {
		deps.fetch = async () =>
			Response.json({ access_token: "fresh", expires_in: 3600 });
		expect(await loadSession(system, deps)).toEqual({
			token: "fresh",
			mcpUrl: CREDENTIAL.mcpUrl,
			source: "file",
		});
		expect(await credentialStore(system).read()).toEqual({
			...CREDENTIAL,
			accessToken: "fresh",
			expiresAt: 3601000,
		});
	});

	test("uses an unexpired token without fetching", async () => {
		await credentialStore(system).write({ ...CREDENTIAL, expiresAt: 31000 });
		expect(await loadSession(system, deps)).toEqual({
			token: "old-access",
			mcpUrl: CREDENTIAL.mcpUrl,
			source: "file",
		});
	});

	test.each([
		[400, '{"error":"invalid_grant"}'],
		[401, '{"error":"access_denied"}'],
	])("rejected refresh becomes a sign-in error: HTTP %s", async (status, body) => {
		deps.fetch = async () => new Response(body, { status });
		await expect(loadSession(system, deps)).rejects.toBeInstanceOf(
			NotSignedInError,
		);
		await expect(loadSession(system, deps)).rejects.toThrow(
			"Session expired. Run tripwire login.",
		);
		expect(await credentialStore(system).read()).toEqual(CREDENTIAL);
	});

	test("a missing refresh token becomes a sign-in error", async () => {
		await credentialStore(system).write({
			...CREDENTIAL,
			refreshToken: undefined,
		});
		await expect(loadSession(system, deps)).rejects.toBeInstanceOf(
			NotSignedInError,
		);
	});

	test.each([
		[200, "not JSON"],
		[200, '{"access_token":17}'],
		[503, '{"error":"unavailable"}'],
	])("malformed or unavailable refresh stays retryable: HTTP %s %s", async (status, body) => {
		deps.fetch = async () => new Response(body, { status });
		await expect(loadSession(system, deps)).rejects.toBeInstanceOf(
			AuthUnreachableError,
		);
		expect(await credentialStore(system).read()).toEqual(CREDENTIAL);
	});

	test.each([
		new Error("offline"),
		"offline",
		null,
		{ message: "offline" },
	])("arbitrary network rejections stay retryable: %j", async (error) => {
		deps.fetch = async () => {
			throw error;
		};
		await expect(loadSession(system, deps)).rejects.toBeInstanceOf(
			AuthUnreachableError,
		);
		expect(await credentialStore(system).read()).toEqual(CREDENTIAL);
	});

	test("credential write errors are not relabeled as expired sessions", async () => {
		const storageError = new Error("keyring unavailable");
		system = {
			...system,
			platform: "darwin",
			env: { ...system.env, TRIPWIRE_CREDENTIAL_STORE: "keychain" },
			which: () => "/mock/security",
			run: async (_binary, args) => {
				if (args[0] === "find-generic-password") {
					return { ok: true, stdout: JSON.stringify(CREDENTIAL), stderr: "" };
				}
				throw storageError;
			},
		};
		deps.fetch = async () => Response.json({ access_token: "fresh" });
		await expect(loadSession(system, deps)).rejects.toBe(storageError);
	});
});
