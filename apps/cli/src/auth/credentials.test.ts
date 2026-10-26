import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Credential, credentialStore } from "#/auth/credentials";
import type { RunResult, System } from "#/system";

const CREDENTIAL: Credential = {
	accessToken: "access",
	refreshToken: "refresh",
	mcpUrl: "https://mcp.example/mcp",
	authUrl: "https://app.example/api/auth",
};

function fakeSystem(keychain: RunResult): System {
	const home = mkdtempSync(join(tmpdir(), "tripwire-creds-"));
	return {
		platform: "darwin",
		home,
		env: {
			TRIPWIRE_MCP_URL: CREDENTIAL.mcpUrl,
			TRIPWIRE_AUTH_URL: CREDENTIAL.authUrl,
		},
		macAppDirs: [],
		run: async () => keychain,
		runInteractive: async () => keychain,
		which: (binary) => (binary === "security" ? "/usr/bin/security" : null),
		exists: () => false,
		list: () => [],
	};
}

describe("credentialStore", () => {
	test("reads the file when the keychain has no token", async () => {
		const system = fakeSystem({ ok: false, stdout: "", stderr: "" });
		const file = credentialStore({
			...system,
			env: { ...system.env, TRIPWIRE_CREDENTIAL_STORE: "file" },
		});
		await file.write(CREDENTIAL);
		expect(await credentialStore(system).read()).toEqual(CREDENTIAL);
	});

	test("clear removes the file copy too", async () => {
		const system = fakeSystem({ ok: false, stdout: "", stderr: "" });
		const file = credentialStore({
			...system,
			env: { ...system.env, TRIPWIRE_CREDENTIAL_STORE: "file" },
		});
		await file.write(CREDENTIAL);
		await credentialStore(system).clear();
		expect(await file.read()).toBeNull();
	});

	test("prefers the keychain token", async () => {
		const keychained = { ...CREDENTIAL, accessToken: "from-keychain" };
		const system = fakeSystem({
			ok: true,
			stdout: JSON.stringify(keychained),
			stderr: "",
		});
		expect(await credentialStore(system).read()).toEqual(keychained);
	});
});

const PRODUCTION: Credential = {
	accessToken: "production-access",
	refreshToken: "production-refresh",
	mcpUrl: "https://mcp.tripwire.sh/mcp",
	authUrl: "https://app.tripwire.sh/api/auth",
};

for (const platform of ["darwin", "linux", "win32"] as const) {
	test(`${platform}: staging read, write and clear preserve production and its file fallback`, async () => {
		const values = new Map<string, string>();
		const accounts: string[] = [];
		const system: System = {
			...fakeSystem({ ok: false, stdout: "", stderr: "" }),
			platform,
			env: {},
			which: (binary) =>
				["security", "secret-tool"].includes(binary) ? `/mock/${binary}` : null,
			run: async (_binary, args, input) => {
				const command = input?.startsWith("add-generic-password")
					? input.trim().split(" ")
					: args;
				const account =
					command[
						command.indexOf(platform === "darwin" ? "-a" : "account") + 1
					];
				if (!account) throw new Error("Missing account");
				accounts.push(account);
				const action = command[0];
				if (action === "add-generic-password") {
					values.set(
						account,
						Buffer.from(
							command[command.indexOf("-X") + 1] ?? "",
							"hex",
						).toString(),
					);
				} else if (action === "store") {
					values.set(account, input ?? "");
				} else if (action === "delete-generic-password" || action === "clear") {
					values.delete(account);
				}
				return {
					ok: values.has(account),
					stdout: values.get(account) ?? "",
					stderr: "",
				};
			},
		};
		const production = credentialStore(system);
		const productionFile = credentialStore({
			...system,
			env: { TRIPWIRE_CREDENTIAL_STORE: "file" },
		});
		await production.write(PRODUCTION);
		await productionFile.write(PRODUCTION);
		expect(productionFile.location).toEndWith("/tripwire/credentials.json");
		accounts.length = 0;
		const stagingSystem = { ...system, env: { TRIPWIRE_ENV: "staging" } };
		const staging = credentialStore(stagingSystem);
		expect(await staging.read()).toBeNull();
		const stage = {
			...PRODUCTION,
			accessToken: "staging-access",
			mcpUrl: "https://tripwire-mcp-preview-tripwire.unkey.app/mcp",
			authUrl: "https://staging.tripwire.sh/api/auth",
		};
		const fallback = credentialStore({
			...stagingSystem,
			env: { ...stagingSystem.env, TRIPWIRE_CREDENTIAL_STORE: "file" },
		});
		await fallback.write(stage);
		expect(await staging.read()).toEqual(stage);
		await staging.write(stage);
		expect(await staging.read()).toEqual(stage);
		await staging.clear();
		expect(await staging.read()).toBeNull();
		expect(await fallback.read()).toBeNull();
		expect(accounts).not.toContain("default");
		if (platform !== "win32") {
			expect(accounts.length).toBeGreaterThan(0);
			expect(
				accounts.every((value) => /^staging-[a-f0-9]{64}$/.test(value)),
			).toBe(true);
		}
		expect(await production.read()).toEqual(PRODUCTION);
		expect(await productionFile.read()).toEqual(PRODUCTION);
	});
}

test("changing either endpoint cannot reuse a saved credential", async () => {
	const system = fakeSystem({ ok: false, stdout: "", stderr: "" });
	system.env.TRIPWIRE_CREDENTIAL_STORE = "file";
	await credentialStore(system).write(CREDENTIAL);
	for (const env of [
		{ ...system.env, TRIPWIRE_AUTH_URL: "https://other.example/api/auth" },
		{ ...system.env, TRIPWIRE_MCP_URL: "https://other.example/mcp" },
	]) {
		expect(await credentialStore({ ...system, env }).read()).toBeNull();
	}
	expect(await credentialStore(system).read()).toEqual(CREDENTIAL);
});
