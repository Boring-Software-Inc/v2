import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("one advertised provider result", () => {
	test("login and Connect consume the same query and browser-safe helper", () => {
		const login = readFileSync(
			new URL("../components/auth/forge-grid.tsx", import.meta.url),
			"utf8",
		);
		const connect = readFileSync(
			new URL("../components/forges/connect-forge-grid.tsx", import.meta.url),
			"utf8",
		);
		for (const source of [login, connect]) {
			expect(source).toContain("providerAvailabilityQueryOptions()");
			expect(source).toContain('from "@tripwire/utils/forge-sign-in"');
			expect(source).toContain("availableForges(providers.data)");
			expect(source).not.toContain("forgeConnectable");
			expect(source).not.toContain("forgeSignIn");
			expect(source).not.toContain("const STATE");
		}
		expect(connect).toContain('orgInstallUrlQueryOptions(org ?? "", forge.id)');
	});
});
