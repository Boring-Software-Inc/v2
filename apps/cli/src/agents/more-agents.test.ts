import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { type Agent, buildAgents } from "#/agents";
import { hostAgentId } from "#/agents/host";
import { detectAgents, installAgent } from "#/run";
import { realSystem, type System } from "#/system";
import { makeSandbox, type Sandbox } from "../../test/sandbox";

const URL = "https://mcp.tripwire.sh/mcp";
const OLD_URL = "https://old.example/mcp";
const OTHER = { url: "https://mcp.linear.app/mcp" };
let sandbox: Sandbox;
let system: System;

beforeEach(() => {
	sandbox = makeSandbox();
	system = realSystem(sandbox.env, "darwin");
});

afterEach(() => sandbox.cleanup());

function agent(id: string): Agent {
	const found = buildAgents(system).find((candidate) => candidate.id === id);
	if (!found) throw new Error(`missing ${id}`);
	return found;
}

async function detectedIds(): Promise<string[]> {
	const found = await detectAgents(buildAgents(system));
	return found.map(({ agent: detected }) => detected.id);
}

function home(...parts: string[]): string {
	return join(sandbox.home, ...parts);
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function fakeCli(file: string, key: string, urlArg: number): string {
	return `printf "%s\\n" "$(/usr/bin/basename "$0") $*" >> "$ARGV_LOG"
if [ "$1 $2" = "mcp add" ]; then
  /bin/mkdir -p "$(/usr/bin/dirname "$HOME/${file}")"
  eval "u=\\\${${urlArg}}"
  printf '{"${key}":{"other":{"url":"https://mcp.linear.app/mcp"},"tripwire":{"url":"%s"}}}' "$u" > "$HOME/${file}"
fi
if [ "$1 $2" = "mcp remove" ]; then
  printf '{"${key}":{"other":{"url":"https://mcp.linear.app/mcp"}}}' > "$HOME/${file}"
fi
exit 0`;
}

describe("detection of the wider agent set", () => {
	test.each([
		["opencode", "opencode"],
		["gemini", "gemini"],
		["agy", "antigravity"],
		["copilot", "copilot"],
		["amp", "amp"],
		["droid", "droid"],
		["cline", "cline"],
		["kilo", "kilo"],
		["kilocode", "kilo"],
		["kiro-cli", "kiro"],
		["kiro", "kiro"],
		["zed", "zed"],
		["goose", "goose"],
		["muse", "muse"],
	])("the %s binary detects %s", async (binary, id) => {
		sandbox.addBinary(binary, "exit 0");
		expect(await detectedIds()).toEqual([id]);
	});

	test.each([
		["OpenCode.app", "opencode"],
		["Antigravity.app", "antigravity"],
		["Kiro.app", "kiro"],
		["Zed.app", "zed"],
		["Zed Preview.app", "zed"],
		["Goose.app", "goose"],
	])("the %s bundle detects %s", async (app, id) => {
		mkdirSync(join(sandbox.env.TRIPWIRE_APP_DIRS ?? "", app), {
			recursive: true,
		});
		expect(await detectedIds()).toEqual([id]);
	});

	test("editor extensions detect Cline and Kilo Code", async () => {
		mkdirSync(home(".vscode", "extensions", "saoudrizwan.claude-dev-3.40.0"), {
			recursive: true,
		});
		mkdirSync(home(".cursor", "extensions", "kilocode.kilo-code-5.1.0"), {
			recursive: true,
		});
		expect(await detectedIds()).toEqual(["cline", "kilo"]);
	});

	test("config and skill folders alone detect nothing", async () => {
		for (const dir of [
			[".gemini", "config", "skills"],
			[".gemini", "antigravity-cli", "skills"],
			[".copilot"],
			[".factory"],
			[".kiro", "skills"],
			[".cline", "skills"],
			[".config", "opencode"],
			[".config", "kilo"],
			[".config", "zed"],
			[".config", "goose"],
			[".config", "muse"],
			[".config", "amp"],
			[".agents", "skills"],
			[".vscode", "extensions", "esbenp.prettier-vscode-11.0.0"],
		]) {
			mkdirSync(home(...dir), { recursive: true });
		}
		expect(await detectedIds()).toEqual([]);
	});
});

describe("CLI-driven agents", () => {
	test.each([
		{ id: "claude", file: ".claude.json", key: "mcpServers" },
		{ id: "gemini", file: ".gemini/settings.json", key: "mcpServers" },
		{ id: "copilot", file: ".copilot/mcp-config.json", key: "mcpServers" },
		{ id: "amp", file: ".config/amp/settings.json", key: "amp.mcpServers" },
		{ id: "droid", file: ".factory/mcp.json", key: "mcpServers" },
	])("$id: staging alone is absent; updating production removes only production", async (row) => {
		const calls: string[][] = [];
		system = {
			...system,
			run: async (_command, args) => {
				calls.push(args);
				return { ok: true, stdout: "", stderr: "" };
			},
		};
		const staging = {
			url: "https://tripwire-mcp-preview-tripwire.unkey.app/mcp",
		};
		writeJson(home(row.file), { [row.key]: { "tripwire-staging": staging } });
		const target = agent(row.id);
		expect(await target.hasServer()).toBe(false);
		expect((await target.addServer(URL)).outcome).toBe("added");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("add");
		calls.length = 0;
		writeJson(home(row.file), {
			[row.key]: { "tripwire-staging": staging, tripwire: { url: OLD_URL } },
		});
		expect(await target.hasServer()).toBe(true);
		expect((await target.addServer(URL)).outcome).toBe("updated");
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain("remove");
		expect(calls[0]).toContain("tripwire");
		expect(calls.flat()).not.toContain("tripwire-staging");
	});

	test.each([
		{
			id: "gemini",
			binary: "gemini",
			file: ".gemini/settings.json",
			key: "mcpServers",
			urlArg: 8,
			add: `gemini mcp add --transport http --scope user tripwire ${URL}`,
			remove: "gemini mcp remove --scope user tripwire",
			skill: ".agents/skills",
		},
		{
			id: "copilot",
			binary: "copilot",
			file: ".copilot/mcp-config.json",
			key: "mcpServers",
			urlArg: 6,
			add: `copilot mcp add --transport http tripwire ${URL}`,
			remove: "copilot mcp remove tripwire",
			skill: ".agents/skills",
		},
		{
			id: "amp",
			binary: "amp",
			file: ".config/amp/settings.json",
			key: "amp.mcpServers",
			urlArg: 4,
			add: `amp mcp add tripwire ${URL}`,
			remove: "amp mcp remove tripwire",
			skill: ".agents/skills",
		},
		{
			id: "droid",
			binary: "droid",
			file: ".factory/mcp.json",
			key: "mcpServers",
			urlArg: 4,
			add: `droid mcp add tripwire ${URL} --type http`,
			remove: "droid mcp remove tripwire",
			skill: ".agents/skills",
		},
	])("$id: adds once, replaces a stale url, keeps other servers", async (row) => {
		sandbox.addBinary(row.binary, fakeCli(row.file, row.key, row.urlArg));
		writeJson(home(row.file), {
			[row.key]: { other: OTHER, tripwire: { url: OLD_URL } },
		});
		const target = agent(row.id);
		const first = await installAgent(target, URL);
		const second = await installAgent(target, URL);
		expect(first.kind === "done" && first.mcp.outcome).toBe("updated");
		expect(second.kind === "done" && second.mcp.outcome).toBe("unchanged");
		expect(sandbox.argv()).toEqual([row.remove, row.add]);
		expect(readJson(home(row.file))).toEqual({
			[row.key]: { other: OTHER, tripwire: { url: URL } },
		});
		expect(first.kind === "done" && first.skills.map((s) => s.path)).toEqual([
			home(row.skill, "tripwire-get-started", "SKILL.md"),
		]);
		expect(target.login()).toBeNull();
	});

	test("cline: uses the CLI for a new server, merges the file for a stale one", async () => {
		sandbox.addBinary(
			"cline",
			fakeCli(".cline/data/settings/cline_mcp_settings.json", "mcpServers", 4),
		);
		const cline = agent("cline");
		const first = await installAgent(cline, URL);
		expect(first.kind === "done" && first.mcp.outcome).toBe("added");
		expect(sandbox.argv()).toEqual([
			`cline mcp add tripwire ${URL} --transport http --yes`,
		]);
		const again = await installAgent(cline, URL);
		expect(again.kind === "done" && again.mcp.outcome).toBe("unchanged");
		expect(first.kind === "done" && first.skills.map((s) => s.path)).toEqual([
			home(".cline", "skills", "tripwire-get-started", "SKILL.md"),
		]);
	});
});

describe("file-merged agents", () => {
	test.each([
		{
			id: "opencode",
			setup: () => sandbox.addBinary("opencode", "exit 0"),
			file: ".config/opencode/opencode.json",
			key: "mcp",
			entry: { type: "remote", url: URL, enabled: true },
			skill: ".agents/skills",
			login: ["mcp", "auth", "tripwire"],
		},
		{
			id: "kilo",
			setup: () => sandbox.addBinary("kilo", "exit 0"),
			file: ".config/kilo/kilo.json",
			key: "mcp",
			entry: { type: "remote", url: URL, enabled: true },
			skill: ".agents/skills",
			login: ["mcp", "auth", "tripwire"],
		},
		{
			id: "antigravity",
			setup: () => sandbox.addBinary("agy", "exit 0"),
			file: ".gemini/config/mcp_config.json",
			key: "mcpServers",
			entry: { serverUrl: URL },
			skill: ".gemini/antigravity-cli/skills",
			login: null,
		},
		{
			id: "kiro",
			setup: () => sandbox.addBinary("kiro-cli", "exit 0"),
			file: ".kiro/settings/mcp.json",
			key: "mcpServers",
			entry: { url: URL },
			skill: ".kiro/skills",
			login: null,
		},
		{
			id: "zed",
			setup: () => sandbox.addBinary("zed", "exit 0"),
			file: ".config/zed/settings.json",
			key: "context_servers",
			entry: { url: URL },
			skill: ".agents/skills",
			login: null,
		},
		{
			id: "cline",
			setup: () =>
				mkdirSync(
					home(".vscode", "extensions", "saoudrizwan.claude-dev-3.40.0"),
					{
						recursive: true,
					},
				),
			file: ".cline/data/settings/cline_mcp_settings.json",
			key: "mcpServers",
			entry: { type: "streamableHttp", url: URL, disabled: false },
			skill: ".cline/skills",
			login: null,
		},
	])("$id: idempotent merge that keeps other servers", async (row) => {
		row.setup();
		const path = home(row.file);
		writeJson(path, { theme: "dark", [row.key]: { other: OTHER } });
		const target = agent(row.id);
		expect(await target.hasServer()).toBe(false);
		const first = await installAgent(target, URL);
		const written = readFileSync(path, "utf8");
		const second = await installAgent(target, URL);
		expect(first.kind === "done" && first.mcp.outcome).toBe("added");
		expect(second.kind === "done" && second.mcp.outcome).toBe("unchanged");
		expect(readFileSync(path, "utf8")).toBe(written);
		expect(readJson(path)).toEqual({
			theme: "dark",
			[row.key]: { other: OTHER, tripwire: row.entry },
		});
		expect(await target.hasServer()).toBe(true);
		expect(first.kind === "done" && first.skills.map((s) => s.path)).toEqual([
			home(row.skill, "tripwire-get-started", "SKILL.md"),
		]);
		expect(target.login()?.args ?? null).toEqual(
			row.login === null ? null : [...row.login],
		);
		expect(sandbox.argv()).toEqual([]);
	});

	test("zed: keeps the comments in a JSONC settings file", async () => {
		sandbox.addBinary("zed", "exit 0");
		const path = home(".config", "zed", "settings.json");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			'// Zed settings\n{\n  // font\n  "buffer_font_size": 15,\n}\n',
		);
		await installAgent(agent("zed"), URL);
		const text = readFileSync(path, "utf8");
		expect(text).toContain("// Zed settings");
		expect(text).toContain("// font");
		expect(text).toContain(`"url": "${URL}"`);
	});

	test("opencode: prefers an existing opencode.jsonc", async () => {
		sandbox.addBinary("opencode", "exit 0");
		const path = home(".config", "opencode", "opencode.jsonc");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, '{\n  // mine\n  "theme": "x"\n}\n');
		const result = await installAgent(agent("opencode"), URL);
		expect(result.kind === "done" && result.mcp.target).toBe(path);
		expect(readFileSync(path, "utf8")).toContain("// mine");
	});

	test("antigravity: the app gets the IDE skills folder", async () => {
		mkdirSync(join(sandbox.env.TRIPWIRE_APP_DIRS ?? "", "Antigravity.app"), {
			recursive: true,
		});
		expect(agent("antigravity").skillsDirs()).toEqual([
			home(".gemini", "config", "skills"),
		]);
	});

	test("muse: adds schema_version to a new file and an optional server", async () => {
		sandbox.addBinary("muse", "exit 0");
		const muse = agent("muse");
		const path = home(".config", "muse", "settings.json");
		await installAgent(muse, URL);
		const again = await installAgent(muse, URL);
		expect(again.kind === "done" && again.mcp.outcome).toBe("unchanged");
		expect(readJson(path)).toEqual({
			schema_version: 1,
			mcp_servers: {
				tripwire: {
					transport: "streamable_http",
					url: URL,
					enabled: true,
					mode: "optional",
				},
			},
		});
		expect(muse.login()?.args).toEqual(["mcp", "login", "tripwire"]);
	});

	test("muse: keeps the existing schema_version and servers", async () => {
		sandbox.addBinary("muse", "exit 0");
		const path = home(".config", "muse", "settings.json");
		writeJson(path, { schema_version: 1, mcp_servers: { other: OTHER } });
		await installAgent(agent("muse"), URL);
		const config = readJson(path);
		expect(config).toMatchObject({
			schema_version: 1,
			mcp_servers: { other: OTHER, tripwire: { url: URL } },
		});
	});

	test("goose: merges the YAML extensions map and keeps comments", async () => {
		sandbox.addBinary("goose", "exit 0");
		const path = home(".config", "goose", "config.yaml");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			"# my goose\nGOOSE_PROVIDER: anthropic\nextensions:\n  developer:\n    type: builtin\n    enabled: true\n",
		);
		const goose = agent("goose");
		expect(await goose.hasServer()).toBe(false);
		const first = await installAgent(goose, URL);
		const written = readFileSync(path, "utf8");
		const second = await installAgent(goose, URL);
		expect(first.kind === "done" && first.mcp.outcome).toBe("added");
		expect(second.kind === "done" && second.mcp.outcome).toBe("unchanged");
		expect(readFileSync(path, "utf8")).toBe(written);
		expect(written).toStartWith("# my goose\n");
		expect(parseYaml(written)).toEqual({
			GOOSE_PROVIDER: "anthropic",
			extensions: {
				developer: { type: "builtin", enabled: true },
				tripwire: {
					type: "streamable_http",
					name: "tripwire",
					enabled: true,
					uri: URL,
					headers: {},
					env_keys: [],
					envs: {},
					timeout: 300,
				},
			},
		});
		expect(await goose.hasServer()).toBe(true);
	});

	test("goose: refuses a config that is not a mapping", async () => {
		sandbox.addBinary("goose", "exit 0");
		const path = home(".config", "goose", "config.yaml");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "- a\n- b\n");
		const result = await installAgent(agent("goose"), URL);
		expect(result.kind).toBe("failed");
		expect(readFileSync(path, "utf8")).toBe("- a\n- b\n");
	});
});

describe("hostAgentId for the wider set", () => {
	test("maps declared agents", () => {
		expect(hostAgentId({ AI_AGENT: "opencode" })).toBe("opencode");
		expect(hostAgentId({ AI_AGENT: "gemini-cli" })).toBe("gemini");
		expect(hostAgentId({ AI_AGENT: "copilot-cli" })).toBe("copilot");
		expect(hostAgentId({ AI_AGENT: "muse-code" })).toBe("muse");
		expect(hostAgentId({ GEMINI_CLI: "1" })).toBe("gemini");
	});
});
