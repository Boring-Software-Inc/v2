import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type FakeServer,
	startFakeServer,
	TEST_TOKEN,
	type ToolCall,
} from "./fake-server";
import { makeSandbox, runCli, type Sandbox } from "./sandbox";

let server: FakeServer;
let sandbox: Sandbox;

beforeAll(() => {
	server = startFakeServer();
});

afterAll(async () => {
	await server.stop();
});

beforeEach(() => {
	sandbox = makeSandbox();
	server.calls.length = 0;
});

afterEach(() => sandbox.cleanup());

function env(extra: Record<string, string> = {}) {
	return {
		...sandbox.env,
		TRIPWIRE_MCP_URL: server.url,
		TRIPWIRE_TOKEN: TEST_TOKEN,
		...extra,
	};
}

describe("management commands over MCP", () => {
	test("whoami --json prints structured content", async () => {
		const result = await runCli(["--json", "whoami"], env());
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			login: "octocat",
			accessStatus: "approved",
			orgs: [{ slug: "acme", role: "admin" }],
		});
		expect(result.stdout).not.toContain(TEST_TOKEN);
	});

	test("whoami prints text for humans", async () => {
		const result = await runCli(["whoami"], env());
		expect(result.stdout.trim()).toBe("octocat, approved, orgs: acme (admin)");
	});

	test("commands map to tools with org and args", async () => {
		const cases: Array<[string[], string, ToolCall["args"]]> = [
			[["status"], "setup_status", { org: "acme" }],
			[["repos"], "list_repos", { org: "acme" }],
			[["rules", "list"], "list_rule_catalog", { org: "acme" }],
			[
				["rules", "list", "acme/web"],
				"get_repo_rules",
				{ org: "acme", repo: "acme/web" },
			],
			[
				[
					"rules",
					"set",
					"acme/web",
					"account-age@1",
					"--enable",
					"--param",
					"minDays=30",
					"--param",
					"mode=strict",
				],
				"set_rule",
				{
					org: "acme",
					repo: "acme/web",
					ruleId: "account-age@1",
					enabled: true,
					params: { minDays: 30, mode: "strict" },
				},
			],
			[
				["gate", "on", "acme/web"],
				"turn_on_gate",
				{ org: "acme", repo: "acme/web" },
			],
			[
				["workflows", "list", "acme/web"],
				"list_workflows",
				{ org: "acme", repo: "acme/web" },
			],
			[
				["workflows", "disable", "acme/web", "wf_1"],
				"set_workflow_enabled",
				{ org: "acme", repo: "acme/web", workflowId: "wf_1", enabled: false },
			],
			[
				["runs", "list", "--repo", "acme/web", "--limit", "5"],
				"list_runs",
				{ org: "acme", repo: "acme/web", limit: 5 },
			],
			[["queue", "list"], "list_moderation_queue", { org: "acme" }],
		];
		for (const [args, tool, expected] of cases) {
			server.calls.length = 0;
			const result = await runCli(["--org", "acme", "--json", ...args], env());
			expect(result.code).toBe(0);
			expect(server.calls).toEqual([{ name: tool, args: expected }]);
		}
	});

	test("TRIPWIRE_ORG is used when --org is absent", async () => {
		await runCli(["repos"], env({ TRIPWIRE_ORG: "beta" }));
		expect(server.calls).toEqual([
			{ name: "list_repos", args: { org: "beta" } },
		]);
	});

	test("a ban prints the confirm link for a human", async () => {
		const result = await runCli(["queue", "decide", "item_9", "ban"], env());
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(
			"Open this link to confirm: https://app.tripwire.sh/acme/confirm/ban_123",
		);
		expect(server.calls).toEqual([
			{ name: "decide_moderation", args: { itemId: "item_9", action: "ban" } },
		]);
	});

	test("rejects unknown queue actions before calling the server", async () => {
		const result = await runCli(["queue", "decide", "item_9", "delete"], env());
		expect(result.code).toBe(1);
		expect(server.calls).toEqual([]);
	});

	test("tool errors exit 1 and show as json errors", async () => {
		const result = await runCli(["--json", "runs", "show", "r1"], env());
		expect(result.code).toBe(1);
		expect(JSON.parse(result.stdout)).toEqual({ error: "run not found" });
	});

	test("a rejected token says to log in", async () => {
		const result = await runCli(["whoami"], env({ TRIPWIRE_TOKEN: "wrong" }));
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("Run tripwire login");
		expect(result.stderr).not.toContain("wrong");
	});

	test("no token at all says to log in", async () => {
		const { TRIPWIRE_TOKEN: _drop, ...rest } = env();
		const result = await runCli(["--json", "status"], rest);
		expect(result.code).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("Not signed in");
	});

	test("reads a stored token from the 0600 credentials file", async () => {
		const dir = join(sandbox.home, ".config", "tripwire");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "credentials.json");
		writeFileSync(
			file,
			JSON.stringify({
				accessToken: TEST_TOKEN,
				mcpUrl: server.url,
				authUrl: "http://127.0.0.1:1",
			}),
			{ mode: 0o600 },
		);
		const { TRIPWIRE_TOKEN: _drop, TRIPWIRE_MCP_URL: _url, ...rest } = env();
		const result = await runCli(["whoami"], rest);
		expect(result.code).toBe(0);
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	test("logout removes the stored token", async () => {
		const dir = join(sandbox.home, ".config", "tripwire");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "credentials.json"),
			JSON.stringify({
				accessToken: "x",
				mcpUrl: server.url,
				authUrl: "http://127.0.0.1:1",
			}),
		);
		const result = await runCli(["logout"], sandbox.env);
		expect(result.stdout.trim()).toBe("Signed out.");
		const again = await runCli(["logout"], sandbox.env);
		expect(again.stdout.trim()).toBe("Not signed in.");
	});
});
