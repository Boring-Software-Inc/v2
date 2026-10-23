import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAgents } from "#/agents";
import { codexServerUrl } from "#/agents/codex";
import { detectAgents, installAgent } from "#/run";
import { realSystem, type System } from "#/system";
import {
	FAKE_CLAUDE,
	FAKE_CODEX,
	makeSandbox,
	type Sandbox,
} from "../../test/sandbox";

const URL = "https://mcp.tripwire.sh/mcp";
let sandbox: Sandbox;
let system: System;

beforeEach(() => {
	sandbox = makeSandbox();
	system = realSystem(sandbox.env, "darwin");
});

afterEach(() => sandbox.cleanup());

function detectedIds(): Promise<string[]> {
	return detectAgents(buildAgents(system)).then((found) =>
		found.map(({ agent }) => agent.id),
	);
}

describe("agent detection", () => {
	test("finds nothing on an empty PATH and HOME", async () => {
		expect(await detectedIds()).toEqual([]);
	});

	test("finds CLIs on PATH", async () => {
		sandbox.addBinary("claude", FAKE_CLAUDE);
		sandbox.addBinary("codex", FAKE_CODEX);
		sandbox.addBinary("grok", "exit 0");
		expect(await detectedIds()).toEqual(["claude", "codex", "grok"]);
	});

	test("finds macOS app bundles", async () => {
		const apps = sandbox.env.TRIPWIRE_APP_DIRS ?? "";
		for (const app of [
			"Cursor.app",
			"Visual Studio Code.app",
			"Windsurf.app",
		]) {
			mkdirSync(join(apps, app), { recursive: true });
		}
		expect(await detectedIds()).toEqual(["cursor", "vscode", "devin"]);
	});

	test("ignores config dirs that skill installers create", async () => {
		mkdirSync(join(sandbox.home, ".codeium", "windsurf", "skills"), {
			recursive: true,
		});
		mkdirSync(join(sandbox.home, ".config", "devin", "skills"), {
			recursive: true,
		});
		mkdirSync(join(sandbox.home, ".cursor"), { recursive: true });
		expect(await detectedIds()).toEqual([]);
	});

	test("marks agents that already have the server", async () => {
		sandbox.addBinary("claude", FAKE_CLAUDE);
		writeFileSync(
			join(sandbox.home, ".claude.json"),
			JSON.stringify({ mcpServers: { tripwire: { type: "http", url: URL } } }),
		);
		const [claude] = await detectAgents(buildAgents(system));
		expect(claude?.installed).toBe(true);
	});
});

describe("agent install", () => {
	test("claude: mcp add at user scope plus the skill", async () => {
		sandbox.addBinary("claude", FAKE_CLAUDE);
		const [claude] = buildAgents(system);
		if (!claude) throw new Error("missing claude");
		const result = await installAgent(claude, URL);
		expect(result.kind).toBe("done");
		expect(sandbox.argv()).toEqual([
			`claude mcp add --transport http tripwire ${URL} --scope user`,
		]);
		const skill = readFileSync(
			join(
				sandbox.home,
				".claude",
				"skills",
				"tripwire-get-started",
				"SKILL.md",
			),
			"utf8",
		);
		expect(skill).toStartWith("---\nname: tripwire-get-started\n");
		expect(claude.login()?.args).toEqual(["mcp", "login", "tripwire"]);
	});

	test("claude: replaces a stale url, skips a current one", async () => {
		sandbox.addBinary("claude", FAKE_CLAUDE);
		writeFileSync(
			join(sandbox.home, ".claude.json"),
			JSON.stringify({
				mcpServers: { tripwire: { url: "https://old.example/mcp" } },
			}),
		);
		const [claude] = buildAgents(system);
		if (!claude) throw new Error("missing claude");
		const first = await installAgent(claude, URL);
		const second = await installAgent(claude, URL);
		expect(first.kind === "done" && first.mcp.outcome).toBe("updated");
		expect(second.kind === "done" && second.mcp.outcome).toBe("unchanged");
		expect(sandbox.argv()).toEqual([
			"claude mcp remove tripwire --scope user",
			`claude mcp add --transport http tripwire ${URL} --scope user`,
		]);
	});

	test("cursor: merges ~/.cursor/mcp.json without touching other servers", async () => {
		const path = join(sandbox.home, ".cursor", "mcp.json");
		mkdirSync(join(sandbox.home, ".cursor"), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({ mcpServers: { other: { command: "x" } } }),
		);
		const cursor = buildAgents(system).find((agent) => agent.id === "cursor");
		if (!cursor) throw new Error("missing cursor");
		await installAgent(cursor, URL);
		const again = await installAgent(cursor, URL);
		expect(again.kind === "done" && again.mcp.outcome).toBe("unchanged");
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			mcpServers: { other: { command: "x" }, tripwire: { url: URL } },
		});
		expect(cursor.login()).toBeNull();
	});

	test("vscode: uses code --add-mcp when the CLI exists", async () => {
		sandbox.addBinary("code", 'printf "%s\\n" "code $*" >> "$ARGV_LOG"');
		const vscode = buildAgents(system).find((agent) => agent.id === "vscode");
		if (!vscode) throw new Error("missing vscode");
		await installAgent(vscode, URL);
		expect(sandbox.argv()).toEqual([
			`code --add-mcp {"name":"tripwire","type":"http","url":"${URL}"}`,
		]);
	});

	test("devin: writes serverUrl to the Devin and Windsurf configs", async () => {
		sandbox.addBinary("windsurf", "exit 0");
		sandbox.addBinary("devin", "exit 0");
		const devin = buildAgents(system).find((agent) => agent.id === "devin");
		if (!devin) throw new Error("missing devin");
		const result = await installAgent(devin, URL);
		expect(result.kind).toBe("done");
		for (const path of [
			join(sandbox.home, ".config", "devin", "mcp_config.json"),
			join(sandbox.home, ".codeium", "windsurf", "mcp_config.json"),
		]) {
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
				mcpServers: { tripwire: { serverUrl: URL } },
			});
		}
	});

	test("grok: mcp add plus the shared skill", async () => {
		sandbox.addBinary("grok", 'printf "%s\\n" "grok $*" >> "$ARGV_LOG"');
		const grok = buildAgents(system).find((agent) => agent.id === "grok");
		if (!grok) throw new Error("missing grok");
		const result = await installAgent(grok, URL);
		expect(result.kind === "done" && result.skills.map((s) => s.path)).toEqual([
			join(
				sandbox.home,
				".agents",
				"skills",
				"tripwire-get-started",
				"SKILL.md",
			),
		]);
		expect(sandbox.argv()).toEqual([
			"grok mcp list",
			`grok mcp add --transport http tripwire ${URL}`,
		]);
	});

	test("a failing CLI is reported, not thrown", async () => {
		sandbox.addBinary("codex", 'echo "boom" >&2; exit 3');
		const codex = buildAgents(system).find((agent) => agent.id === "codex");
		if (!codex) throw new Error("missing codex");
		expect(await installAgent(codex, URL)).toEqual({
			kind: "failed",
			message: "boom",
		});
	});
});

describe("codexServerUrl", () => {
	test("reads the url from the server table", () => {
		const toml = `model = "x"\n\n[mcp_servers.other]\nurl = "a"\n\n[mcp_servers.tripwire]\nurl = "${URL}"\n`;
		expect(codexServerUrl(toml, "tripwire")).toBe(URL);
		expect(codexServerUrl(toml, "missing")).toBeNull();
		expect(
			codexServerUrl('[mcp_servers."tripwire"]\ncommand = "x"\n', "tripwire"),
		).toBe("");
	});
});
