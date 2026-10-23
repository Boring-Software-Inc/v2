import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AgentClientLogo,
	type ClientLogoKind,
	clientLogoKind,
} from "#/components/agents/agent-client-logo";

describe("clientLogoKind", () => {
	test.each<[string, ClientLogoKind]>([
		["Claude Code", "claude"],
		["claude-desktop", "claude"],
		["Codex", "openai"],
		["OpenAI Codex CLI", "openai"],
		["ChatGPT", "openai"],
		["Cursor", "cursor"],
		["cursor-vscode", "cursor"],
		["VS Code", "vscode"],
		["Visual Studio Code", "vscode"],
		["vscode-mcp", "vscode"],
		["Windsurf", "windsurf"],
		["Devin", "windsurf"],
		["Tripwire CLI", "tripwire-cli"],
	])("%s matches %s", (name, kind) => {
		expect(clientLogoKind(name)).toBe(kind);
	});

	test("matching ignores case", () => {
		expect(clientLogoKind("CLAUDE CODE")).toBe("claude");
		expect(clientLogoKind("wInDsUrF")).toBe("windsurf");
	});

	test("an unknown client gets the generic agent", () => {
		expect(clientLogoKind("Proof Agent")).toBe("generic");
		expect(clientLogoKind("")).toBe("generic");
	});
});

describe("AgentClientLogo", () => {
	test("Claude keeps its brand fill", () => {
		const html = renderToStaticMarkup(
			<AgentClientLogo clientName="Claude Code" />,
		);
		expect(html).toContain('data-logo="claude"');
		expect(html).toContain('fill="#D97757"');
	});

	test("an unknown client renders the generic glyph, not a brand", () => {
		const html = renderToStaticMarkup(
			<AgentClientLogo clientName="Proof Agent" />,
		);
		expect(html).toContain('data-logo="generic"');
		expect(html).not.toContain('<path d="m4.7144');
	});
});
