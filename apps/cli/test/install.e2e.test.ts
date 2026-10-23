import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	FAKE_CLAUDE,
	FAKE_CLIPBOARD,
	FAKE_CODEX,
	makeSandbox,
	runCli,
	type Sandbox,
} from "./sandbox";

const URL = "https://mcp.tripwire.sh/mcp";
const SKILL = join("tripwire-get-started", "SKILL.md");
let sandbox: Sandbox;

beforeEach(() => {
	sandbox = makeSandbox();
	sandbox.addBinary("claude", FAKE_CLAUDE);
	sandbox.addBinary("codex", FAKE_CODEX);
	sandbox.addBinary("pbcopy", FAKE_CLIPBOARD);
	mkdirSync(join(sandbox.env.TRIPWIRE_APP_DIRS ?? "", "Cursor.app"), {
		recursive: true,
	});
	mkdirSync(join(sandbox.home, ".cursor"), { recursive: true });
	writeFileSync(
		join(sandbox.home, ".cursor", "mcp.json"),
		JSON.stringify({
			mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } },
		}),
	);
});

afterEach(() => sandbox.cleanup());

describe("tripwire install (e2e, temp HOME)", () => {
	test("--no-interactive installs MCP and skill into every detected agent", async () => {
		const result = await runCli(
			["install", "acme#abcde12345", "--no-interactive"],
			sandbox.env,
		);
		expect(result.code).toBe(0);
		expect(sandbox.argv().sort()).toEqual([
			`claude mcp add --transport http tripwire ${URL} --scope user`,
			`codex mcp add tripwire --url ${URL}`,
		]);
		expect(existsSync(join(sandbox.home, ".claude", "skills", SKILL))).toBe(
			true,
		);
		expect(existsSync(join(sandbox.home, ".agents", "skills", SKILL))).toBe(
			true,
		);
		expect(
			JSON.parse(
				readFileSync(join(sandbox.home, ".cursor", "mcp.json"), "utf8"),
			),
		).toEqual({
			mcpServers: {
				linear: { url: "https://mcp.linear.app/mcp" },
				tripwire: { url: URL },
			},
		});
		expect(result.stdout).toContain("Detected Claude Code, Codex, and Cursor");
		expect(result.stdout).toContain(
			"Done. Restart Claude Code, Codex, and Cursor.",
		);
		expect(result.stdout).not.toMatch(/[!—·]/);
		expect(existsSync(join(sandbox.home, "clipboard.txt"))).toBe(false);
	});

	test("a second run changes nothing and calls no agent CLI", async () => {
		await runCli(["install", "--no-interactive"], sandbox.env);
		const cursorConfig = readFileSync(
			join(sandbox.home, ".cursor", "mcp.json"),
			"utf8",
		);
		const before = sandbox.argv().length;
		const again = await runCli(["install", "--no-interactive"], sandbox.env);
		expect(again.code).toBe(0);
		expect(sandbox.argv().length).toBe(before);
		expect(again.stdout).toContain("(unchanged)");
		expect(again.stdout).not.toContain("(added)");
		expect(
			readFileSync(join(sandbox.home, ".cursor", "mcp.json"), "utf8"),
		).toBe(cursorConfig);
	});

	test("TRIPWIRE_MCP_URL overrides the server url", async () => {
		const custom = "http://localhost:9999/mcp";
		await runCli(["install", "-y"], {
			...sandbox.env,
			TRIPWIRE_MCP_URL: custom,
		});
		expect(sandbox.argv()).toContain(`codex mcp add tripwire --url ${custom}`);
	});

	test("without a TTY it does not prompt, log in or touch the clipboard", async () => {
		const result = await runCli(["acme#abcde12345"], sandbox.env);
		expect(result.code).toBe(0);
		expect(sandbox.argv().some((line) => line.includes("login"))).toBe(false);
		expect(existsSync(join(sandbox.home, "clipboard.txt"))).toBe(false);
	});

	test("prints sign-in steps and the prompt when it cannot prompt", async () => {
		const result = await runCli(["install", "acme#abcde12345"], sandbox.env);
		expect(result.stdout).toContain(
			"Claude Code: claude mcp login tripwire, or /mcp inside Claude Code",
		);
		expect(result.stdout).toContain("Codex: codex mcp login tripwire");
		expect(result.stdout).toContain("Cursor: the MCP settings in Cursor");
		expect(result.stdout).toContain("org slug: acme");
	});

	test("run by Claude Code itself, it skips login and tells the agent what to do", async () => {
		const result = await runCli(["install", "acme#abcde12345"], {
			...sandbox.env,
			AI_AGENT: "claude-code_2-1-309_agent",
			CLAUDECODE: "1",
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(
			"Claude Code, this session: do not run the login here. Ask the user to sign in with claude mcp login tripwire, or /mcp inside Claude Code.",
		);
		expect(sandbox.argv().some((line) => line.includes("login"))).toBe(false);
	});

	test("--json reports each agent and the prompt", async () => {
		const result = await runCli(
			["--json", "install", "acme#abcde12345"],
			sandbox.env,
		);
		const body = JSON.parse(result.stdout);
		expect(body.prompt).toBe(
			"Please help me set up Tripwire.\n\norg slug: acme\nrun code: abcde12345",
		);
		expect(body.agents.map((agent: { id: string }) => agent.id)).toEqual([
			"claude",
			"codex",
			"cursor",
		]);
	});

	test("a failing agent fails the run but not the others", async () => {
		sandbox.addBinary("codex", 'echo "codex exploded" >&2; exit 1');
		const result = await runCli(["install", "--no-interactive"], sandbox.env);
		expect(result.code).toBe(1);
		expect(result.stdout).toContain("codex exploded");
		expect(result.stdout).toContain("Done. Restart Claude Code and Cursor.");
	});
});
