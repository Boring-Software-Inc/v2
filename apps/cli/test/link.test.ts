import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
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
let project: string;

beforeAll(() => {
	server = startFakeServer();
});

afterAll(async () => {
	await server.stop();
});

beforeEach(() => {
	sandbox = makeSandbox();
	project = join(realpathSync(sandbox.root), "project");
	mkdirSync(project);
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

const linkFile = (dir = project) => join(dir, ".tripwire", "project.json");

function readLink(dir = project) {
	return JSON.parse(readFileSync(linkFile(dir), "utf8"));
}

function link(body: string, dir = project) {
	mkdirSync(join(dir, ".tripwire"), { recursive: true });
	writeFileSync(linkFile(dir), body);
}

function lastCall(): ToolCall | undefined {
	return server.calls.at(-1);
}

describe("pull links the project", () => {
	test("pull saves the repo and org beside tripwire.ts and says so", async () => {
		const result = await runCli(
			["--org", "acme", "workflows", "pull", "scratch"],
			env(),
			project,
		);
		expect(result.code).toBe(0);
		expect(readLink()).toEqual({
			org: "acme",
			repo: "scratch",
			workflows: { "new-accounts": "new-accounts" },
		});
		expect(result.stdout).toContain(`linked    scratch in ${linkFile()}`);
	});

	test("a second pull of the same repo leaves the link alone", async () => {
		await runCli(["workflows", "pull", "scratch"], env(), project);
		const again = await runCli(
			["workflows", "pull", "scratch", "--force"],
			env(),
			project,
		);
		expect(again.code).toBe(0);
		expect(again.stdout).not.toContain("linked");
	});

	test("pull --no-link writes no link", async () => {
		const result = await runCli(
			["workflows", "pull", "scratch", "--no-link"],
			env(),
			project,
		);
		expect(result.code).toBe(0);
		expect(existsSync(linkFile())).toBe(false);
	});

	test("pull --json names the link file", async () => {
		const result = await runCli(
			["--json", "workflows", "pull", "scratch"],
			env(),
			project,
		);
		expect(JSON.parse(result.stdout)).toMatchObject({ link: linkFile() });
	});

	test("pull with no repo pulls the linked one", async () => {
		link('{"org":"acme","repo":"scratch"}');
		const result = await runCli(["workflows", "pull"], env(), project);
		expect(result.code).toBe(0);
		expect(server.calls[0]).toEqual({
			name: "get_workflow",
			args: { org: "acme", repo: "scratch" },
		});
	});
});

describe("commands use the link when org and repo are left out", () => {
	test("diff from a nested folder reads the linked project's tripwire.ts", async () => {
		await runCli(["workflows", "pull", "scratch"], env(), project);
		const nested = join(project, "src");
		mkdirSync(nested);
		server.calls.length = 0;
		const result = await runCli(["workflows", "diff"], env(), nested);
		expect(result.code).toBe(0);
		expect(lastCall()?.name).toBe("validate_workflow");
		expect(lastCall()?.args).toMatchObject({ repo: "scratch" });
	});

	test("a command in a nested folder finds the link above it", async () => {
		link('{"org":"acme","repo":"scratch"}');
		const nested = join(project, "src", "deep");
		mkdirSync(nested, { recursive: true });
		const result = await runCli(["workflows", "list"], env(), nested);
		expect(result.code).toBe(0);
		expect(lastCall()).toEqual({
			name: "list_workflows",
			args: { org: "acme", repo: "scratch" },
		});
	});

	test("an explicit repo and --org win over the link", async () => {
		link('{"org":"acme","repo":"scratch"}');
		await runCli(
			["--org", "other", "workflows", "list", "web"],
			env(),
			project,
		);
		expect(lastCall()?.args).toEqual({ org: "other", repo: "web" });
	});

	test("TRIPWIRE_ORG wins over the linked org", async () => {
		link('{"org":"acme","repo":"scratch"}');
		await runCli(
			["workflows", "list"],
			env({ TRIPWIRE_ORG: "from-env" }),
			project,
		);
		expect(lastCall()?.args).toEqual({ org: "from-env", repo: "scratch" });
	});

	test("a link without an org leaves the org to the server", async () => {
		link('{"repo":"scratch"}');
		await runCli(["gate", "on"], env(), project);
		expect(lastCall()).toEqual({
			name: "turn_on_gate",
			args: { repo: "scratch" },
		});
	});

	test("the linked org applies to commands with no repo", async () => {
		link('{"org":"acme","repo":"scratch"}');
		await runCli(["repos"], env(), project);
		expect(lastCall()).toEqual({ name: "list_repos", args: { org: "acme" } });
	});

	test.each([
		[
			["rules", "set", "account-age@1", "--enable"],
			"set_rule",
			{ repo: "scratch", ruleId: "account-age@1", enabled: true },
		],
		[
			["rules", "set", "web", "account-age@1", "--disable"],
			"set_rule",
			{ repo: "web", ruleId: "account-age@1", enabled: false },
		],
		[
			["workflows", "enable", "stale"],
			"set_workflow_enabled",
			{ repo: "scratch", workflowId: "stale", enabled: true },
		],
		[
			["workflows", "disable", "web", "stale"],
			"set_workflow_enabled",
			{ repo: "web", workflowId: "stale", enabled: false },
		],
		[
			["queue", "decide", "item_9", "approve"],
			"decide_moderation",
			{ repo: "scratch", itemId: "item_9", decision: "approve" },
		],
		[
			["queue", "decide", "web", "item_9", "approve"],
			"decide_moderation",
			{ repo: "web", itemId: "item_9", decision: "approve" },
		],
		[["rules", "list"], "get_repo_rules", { repo: "scratch" }],
		[["rules", "list", "--catalog"], "list_rule_catalog", {}],
		[
			[
				"rules",
				"create",
				"--name",
				"Not into release",
				"--definition",
				'{"when":{"id":"pr.targetBranch"},"comparison":{"kind":"noneOf","args":[["release"]]}}',
			],
			"save_custom_rule",
			{
				repo: "scratch",
				name: "Not into release",
				definition: {
					when: { id: "pr.targetBranch" },
					comparison: { kind: "noneOf", args: [["release"]] },
				},
			},
		],
		[
			["rules", "delete", "custom-not-into-release-1a2b3c"],
			"delete_custom_rule",
			{ repo: "scratch", id: "custom-not-into-release-1a2b3c" },
		],
		[
			["rules", "delete", "web", "custom-not-into-release-1a2b3c"],
			"delete_custom_rule",
			{ repo: "web", id: "custom-not-into-release-1a2b3c" },
		],
	])("%j calls %s", async (args, name, expected) => {
		link('{"org":"acme","repo":"scratch"}');
		const result = await runCli(args, env(), project);
		expect(result.code).toBe(0);
		expect(lastCall()).toEqual({ name, args: { org: "acme", ...expected } });
	});

	test("no repo and no link names both ways out and calls nothing", async () => {
		const result = await runCli(["workflows", "list"], env(), project);
		expect(result.code).toBe(1);
		expect(result.stderr).toBe(
			"error     No repo given. Pass one, or run tripwire link <repo> in this project.\n",
		);
		expect(server.calls).toEqual([]);
	});

	test("a broken link says where it is, and an explicit repo still works", async () => {
		link('{"repo": 3}');
		const broken = await runCli(["workflows", "list"], env(), project);
		expect(broken.code).toBe(1);
		expect(broken.stderr).toContain(
			`${linkFile()} is not a valid Tripwire link. Run tripwire link <repo> to rewrite it.`,
		);
		const explicit = await runCli(["workflows", "list", "web"], env(), project);
		expect(explicit.code).toBe(0);
		expect(lastCall()?.args).toEqual({ repo: "web" });
	});
});

describe("link and unlink", () => {
	test("link checks the repo, then writes the link here", async () => {
		const result = await runCli(
			["--org", "acme", "link", "scratch"],
			env(),
			project,
		);
		expect(result.code).toBe(0);
		expect(server.calls).toEqual([
			{ name: "list_workflows", args: { org: "acme", repo: "scratch" } },
		]);
		expect(readLink()).toEqual({
			org: "acme",
			repo: "scratch",
		});
		expect(result.stdout).toBe(
			["linked    scratch in org acme", `file      ${linkFile()}`, ""].join(
				"\n",
			),
		);
	});

	test("link refuses a repo the server does not know", async () => {
		const result = await runCli(["link", "scratc"], env(), project);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("has no repo named scratc");
		expect(existsSync(linkFile())).toBe(false);
	});

	test("unlink removes the nearest link, then there is nothing to remove", async () => {
		link('{"repo":"scratch"}');
		const nested = join(project, "src");
		mkdirSync(nested);
		const first = await runCli(["unlink"], env(), nested);
		expect(first.stdout).toBe(`done      Unlinked, removed ${linkFile()}\n`);
		expect(existsSync(linkFile())).toBe(false);
		const second = await runCli(["unlink"], env(), nested);
		expect(second.stdout).toBe("done      Not linked\n");
	});

	test("unlink removes a broken link too", async () => {
		link("not json");
		const result = await runCli(["unlink"], env(), project);
		expect(result.code).toBe(0);
		expect(existsSync(linkFile())).toBe(false);
	});

	test("whoami and status show the link", async () => {
		link('{"org":"acme","repo":"scratch"}');
		for (const command of ["whoami", "status"]) {
			const result = await runCli([command], env(), project);
			expect(result.code).toBe(0);
			expect(result.stdout).toEndWith(
				["linked    scratch in org acme", `file      ${linkFile()}`, ""].join(
					"\n",
				),
			);
		}
		const json = await runCli(["--json", "whoami"], env(), project);
		expect(JSON.parse(json.stdout)).toMatchObject({
			link: { org: "acme", repo: "scratch", path: linkFile() },
		});
	});
});
