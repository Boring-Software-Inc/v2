import { describe, expect, test } from "bun:test";
import { claudeSignIn } from "#/agents/claude";
import { codexSignIn } from "#/agents/codex";
import { opencodeSignIn } from "#/agents/opencode";

const CLAUDE_GET = (status: string) => `tripwire:
  Scope: User config (available in all your projects)
  Status: ${status}
  Type: http
  URL: https://mcp.tripwire.sh/mcp

To remove this server, run: claude mcp remove tripwire -s user`;

describe("claude mcp get tripwire", () => {
	test("reads Connected as signed in", () => {
		expect(claudeSignIn(CLAUDE_GET("✔ Connected"))).toBe("signed-in");
	});

	test("reads Needs authentication as signed out", () => {
		expect(claudeSignIn(CLAUDE_GET("! Needs authentication"))).toBe(
			"signed-out",
		);
	});

	test("anything else is unknown", () => {
		expect(claudeSignIn(CLAUDE_GET("✘ Failed to connect"))).toBe("unknown");
		expect(claudeSignIn("")).toBe("unknown");
	});
});

describe("opencode mcp list", () => {
	test("reads the 2.x table", () => {
		expect(
			opencodeSignIn("✓ linear    connected\n✓ tripwire  connected\n"),
		).toBe("signed-in");
		expect(opencodeSignIn("⚠ tripwire  needs authentication\n")).toBe(
			"signed-out",
		);
		expect(opencodeSignIn("✗ tripwire  failed: fetch failed\n")).toBe(
			"unknown",
		);
	});

	test("reads the 1.x clack list with colour codes", () => {
		const line = (icon: string, text: string) =>
			`│\n●  ${icon} tripwire \u001b[90m${text}\n│      \u001b[90mhttps://mcp.tripwire.sh/mcp\n`;
		expect(opencodeSignIn(line("✓", "connected (OAuth)"))).toBe("signed-in");
		expect(opencodeSignIn(line("⚠", "needs authentication"))).toBe(
			"signed-out",
		);
	});

	test("another server's status never counts for tripwire", () => {
		expect(
			opencodeSignIn(
				"✓ tripwire-dev  connected\n⚠ tripwire  needs authentication\n",
			),
		).toBe("signed-out");
		expect(opencodeSignIn("No MCP servers configured\n")).toBe("unknown");
	});
});

describe("codex mcp list --json", () => {
	const list = (status: string) =>
		JSON.stringify([
			{ name: "linear", auth_status: "o_auth" },
			{ name: "tripwire", auth_status: status },
		]);

	test("reads the auth status of the tripwire entry", () => {
		expect(codexSignIn(list("o_auth"))).toBe("signed-in");
		expect(codexSignIn(list("bearer_token"))).toBe("signed-in");
		expect(codexSignIn(list("not_logged_in"))).toBe("signed-out");
		expect(codexSignIn(list("unknown"))).toBe("unknown");
	});

	test("output that is not the list is unknown", () => {
		expect(codexSignIn("error: unexpected argument '--json'")).toBe("unknown");
		expect(codexSignIn("[]")).toBe("unknown");
	});
});
