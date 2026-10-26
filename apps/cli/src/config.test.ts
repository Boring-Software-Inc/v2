import { expect, test } from "bun:test";
import { authUrl, environment, mcpUrl } from "#/config";

test("production defaults remain unchanged", () => {
	expect(mcpUrl({})).toBe("https://mcp.tripwire.sh/mcp");
	expect(authUrl({})).toBe("https://app.tripwire.sh/api/auth");
});

test("staging selects the configured preview resource and issuer", () => {
	const env = { TRIPWIRE_ENV: "staging" };
	expect(mcpUrl(env)).toBe(
		"https://tripwire-mcp-preview-tripwire.unkey.app/mcp",
	);
	expect(authUrl(env)).toBe("https://staging.tripwire.sh/api/auth");
	expect(
		authUrl({ ...env, TRIPWIRE_AUTH_URL: "http://localhost:3000/api/auth/" }),
	).toBe("http://localhost:3000/api/auth");
});

test("a misspelled environment fails instead of selecting production", () => {
	expect(() => environment({ TRIPWIRE_ENV: "stagng" })).toThrow();
});
