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
		["OpenCode", "opencode"],
		["opencode-cli", "opencode"],
		["Gemini CLI", "gemini"],
		["gemini-cli-mcp-client", "gemini"],
		["Google Antigravity", "antigravity"],
		["antigravity-cli", "antigravity"],
		["GitHub Copilot CLI", "copilot"],
		["Amp", "amp"],
		["Sourcegraph Amp CLI", "amp"],
		["Factory Droid", "factory"],
		["droid", "factory"],
		["Cline", "cline"],
		["Kilo Code", "kilo"],
		["Kiro", "kiro"],
		["kiro-cli", "kiro"],
		["Zed", "zed"],
		["Goose", "goose"],
		["Grok Build", "grok"],
		["grok-cli", "grok"],
		["Muse Code", "muse"],
	])("%s matches %s", (name, kind) => {
		expect(clientLogoKind(name)).toBe(kind);
	});

	test("matching ignores case", () => {
		expect(clientLogoKind("CLAUDE CODE")).toBe("claude");
		expect(clientLogoKind("wInDsUrF")).toBe("windsurf");
	});

	test("new agents match whatever the case", () => {
		expect(clientLogoKind("OPENCODE")).toBe("opencode");
		expect(clientLogoKind("muse code")).toBe("muse");
		expect(clientLogoKind("AMP")).toBe("amp");
		expect(clientLogoKind("ZED")).toBe("zed");
		expect(clientLogoKind("KiLo CoDe")).toBe("kilo");
	});

	test("short names match whole words only", () => {
		expect(clientLogoKind("Example Agent")).toBe("generic");
		expect(clientLogoKind("Android Studio")).toBe("generic");
		expect(clientLogoKind("Authorized Client")).toBe("generic");
		expect(clientLogoKind("ngrok tunnel")).toBe("generic");
		expect(clientLogoKind("Museum Bot")).toBe("generic");
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

	test.each<[string, string]>([
		["Gemini CLI", 'fill="#8E75B2"'],
		["Google Antigravity", 'fill="#3186FF"'],
		["Kiro", 'fill="#9046FF"'],
		["Muse Code", 'fill="#0467DF"'],
	])("%s keeps its brand fill", (name, fill) => {
		expect(
			renderToStaticMarkup(<AgentClientLogo clientName={name} />),
		).toContain(fill);
	});

	test.each([
		"OpenCode",
		"GitHub Copilot CLI",
		"Amp",
		"Factory Droid",
		"Cline",
		"Kilo Code",
		"Zed",
		"Goose",
		"Grok",
	])("%s uses currentColor so it reads in both themes", (name) => {
		const html = renderToStaticMarkup(<AgentClientLogo clientName={name} />);
		expect(html).toContain('fill="currentColor"');
		expect(html).toContain("<path");
	});

	test("marks drawn on their own grid keep their viewBox and fill rule", () => {
		const html = renderToStaticMarkup(<AgentClientLogo clientName="Kiro" />);
		expect(html).toContain('viewBox="196 196 808 808"');
		expect(html).toContain('fill-rule="evenodd"');
		expect(
			renderToStaticMarkup(<AgentClientLogo clientName="Claude Code" />),
		).toContain('viewBox="0 0 24 24"');
	});

	test("an unknown client renders the generic glyph, not a brand", () => {
		const html = renderToStaticMarkup(
			<AgentClientLogo clientName="Proof Agent" />,
		);
		expect(html).toContain('data-logo="generic"');
		expect(html).not.toContain('<path d="m4.7144');
	});
});
