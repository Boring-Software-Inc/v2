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
		env: {},
		macAppDirs: [],
		run: async () => keychain,
		runInteractive: async () => keychain,
		which: (binary) => (binary === "security" ? "/usr/bin/security" : null),
		exists: () => false,
	};
}

describe("credentialStore", () => {
	test("reads the file when the keychain has no token", async () => {
		const system = fakeSystem({ ok: false, stdout: "", stderr: "" });
		const file = credentialStore({
			...system,
			env: { TRIPWIRE_CREDENTIAL_STORE: "file" },
		});
		await file.write(CREDENTIAL);
		expect(await credentialStore(system).read()).toEqual(CREDENTIAL);
	});

	test("clear removes the file copy too", async () => {
		const system = fakeSystem({ ok: false, stdout: "", stderr: "" });
		const file = credentialStore({
			...system,
			env: { TRIPWIRE_CREDENTIAL_STORE: "file" },
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
