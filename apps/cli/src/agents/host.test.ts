import { describe, expect, test } from "bun:test";
import { hostAgentId } from "#/agents/host";

describe("hostAgentId", () => {
	test("reads AI_AGENT first", () => {
		expect(hostAgentId({ AI_AGENT: "claude-code_2-1-309_agent" })).toBe(
			"claude",
		);
		expect(hostAgentId({ AI_AGENT: "codex" })).toBe("codex");
		expect(hostAgentId({ AI_AGENT: "cursor-agent" })).toBe("cursor");
		expect(hostAgentId({ AI_AGENT: "github-copilot" })).toBe("unknown");
	});

	test("falls back to agent-specific variables", () => {
		expect(hostAgentId({ CLAUDECODE: "1" })).toBe("claude");
		expect(hostAgentId({ CODEX_SANDBOX: "seatbelt" })).toBe("codex");
		expect(hostAgentId({ CURSOR_AGENT: "1" })).toBe("cursor");
	});

	test("a plain terminal has no host agent", () => {
		expect(hostAgentId({ TERM_PROGRAM: "vscode" })).toBeNull();
		expect(hostAgentId({})).toBeNull();
	});
});
