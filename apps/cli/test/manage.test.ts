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
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
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
	test("login ends with the name it signed in as", async () => {
		const result = await runCli(["login", "--no-browser"], {
			...sandbox.env,
			TRIPWIRE_MCP_URL: server.url,
			TRIPWIRE_AUTH_URL: server.authUrl,
			TRIPWIRE_CREDENTIAL_STORE: "file",
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("done      Signed in as grim\n");
	});

	test("login still names the user when the first whoami is refused", async () => {
		server.rejectNext(1);
		const result = await runCli(["login", "--no-browser"], {
			...sandbox.env,
			TRIPWIRE_MCP_URL: server.url,
			TRIPWIRE_AUTH_URL: server.authUrl,
			TRIPWIRE_CREDENTIAL_STORE: "file",
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("done      Signed in as grim\n");
	});

	test("whoami --json prints the server data", async () => {
		const result = await runCli(["--json", "whoami"], env());
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			user: { name: "grim", email: "vysvisuals@gmail.com" },
			access: { approved: true },
		});
		expect(result.stdout).not.toContain(TEST_TOKEN);
	});

	test("whoami prints aligned plain text for humans", async () => {
		const result = await runCli(["whoami"], env());
		expect(result.stdout).toBe(
			[
				"user      grim  vysvisuals@gmail.com",
				"access    approved",
				"orgs      grim (admin)",
				"",
			].join("\n"),
		);
	});

	test("status shows the next step and the install link", async () => {
		const result = await runCli(["status"], env());
		expect(result.stdout).toBe(
			[
				"org       grim",
				"next      Install the GitHub App",
				"open      https://github.com/apps/tripwire/installations/new?state=s1",
				"",
			].join("\n"),
		);
	});

	test("repos prints a table", async () => {
		const result = await runCli(["repos"], env());
		expect(result.stdout).toBe(
			[
				"REPO                          GATE     TO REVIEW     BLOCKED 24H",
				"scratch                       on       2             5",
				"website                       off      0             0",
				"",
			].join("\n"),
		);
	});

	test("runs list works without a repo and prints a table", async () => {
		const result = await runCli(["runs", "list"], env());
		expect(result.code).toBe(0);
		expect(server.calls).toEqual([{ name: "list_runs", args: {} }]);
		expect(result.stdout.split("\n")[0]).toMatch(
			/^RUN\s+REPO\s+PR\s+STATUS\s+VERDICT\s+CREATED$/,
		);
		expect(result.stdout).toMatch(
			/run_1\s+scratch\s+#12\s+completed\s+Blocked\s+2026-10-22 14:03 UTC/,
		);
	});

	test("human output has no raw JSON, em dashes or exclamation marks", async () => {
		for (const args of [["whoami"], ["status"], ["repos"], ["runs", "list"]]) {
			const result = await runCli(args, env());
			expect(result.stdout).not.toMatch(/[{}!\u2014]/);
		}
	});

	test("tool errors read for humans and name CLI commands, not tools", async () => {
		const result = await runCli(["workflows", "list", "scratc"], env());
		expect(result.code).toBe(1);
		expect(result.stderr).toBe(
			"error     No repo named scratc in grim. Run tripwire repos to see them.\n",
		);
		expect(result.stdout).toBe("");
	});

	test("input validation errors name the missing argument", async () => {
		const result = await runCli(["queue", "list"], env());
		expect(result.code).toBe(1);
		expect(result.stderr).toBe("error     Missing argument: repo.\n");
	});

	test("an unknown command exits 1 and never runs install", async () => {
		const result = await runCli(["list_repos"], env());
		expect(result.code).toBe(1);
		expect(result.stderr).toBe(
			"error     Unknown command list_repos. Run tripwire --help.\n",
		);
		expect(result.stdout).toBe("");
		expect(server.calls).toEqual([]);
		expect(sandbox.argv()).toEqual([]);
		expect(
			readdirSync(sandbox.home).filter((name) => name !== "Library"),
		).toEqual([]);
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
					config: { minDays: 30, mode: "strict" },
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
			[
				["queue", "list", "--repo", "acme/web"],
				"list_moderation_queue",
				{ org: "acme", repo: "acme/web" },
			],
			[
				["queue", "decide", "acme/web", "item_9", "approve"],
				"decide_moderation",
				{
					org: "acme",
					repo: "acme/web",
					itemId: "item_9",
					decision: "approve",
				},
			],
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
		const result = await runCli(
			["queue", "decide", "scratch", "item_9", "ban"],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe(
			[
				"open      https://app.tripwire.sh/grim/scratch/moderation",
				"          Open this link to review the contributor and decide yourself.",
				"",
			].join("\n"),
		);
		expect(server.calls).toEqual([
			{
				name: "decide_moderation",
				args: { repo: "scratch", itemId: "item_9", decision: "ban" },
			},
		]);
	});

	test("rules set needs a change before calling the server", async () => {
		const result = await runCli(["rules", "set", "scratch", "x@1"], env());
		expect(result.code).toBe(1);
		expect(result.stderr).toBe(
			"error     Pass --enable, --disable or --param.\n",
		);
		expect(server.calls).toEqual([]);
	});

	test("rejects unknown queue actions before calling the server", async () => {
		const result = await runCli(
			["queue", "decide", "scratch", "item_9", "deny"],
			env(),
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toBe(
			"error     deny is not a choice. Use approve to let the change request through, remove to block it, or ban to get a link where a person bans the contributor.\n",
		);
		expect(server.calls).toEqual([]);
	});

	test("a decision says what was decided and on what", async () => {
		server.answerNext("decide_moderation", {
			done: true,
			alreadyDecided: false,
			decision: "approve",
			itemId: "item_9",
			repo: "grim/scratch",
			number: 138,
		});
		const result = await runCli(
			["queue", "decide", "scratch", "item_9", "approve"],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("done      Approved #138 on grim/scratch\n");
	});

	test("tool errors exit 1 and show as json errors", async () => {
		const result = await runCli(["--json", "runs", "show", "r1"], env());
		expect(result.code).toBe(1);
		expect(JSON.parse(result.stdout)).toEqual({
			error: "No run r1 in grim. Call list_runs to see recent runs.",
		});
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
		expect(result.stdout).toBe("done      Signed out\n");
		const again = await runCli(["logout"], sandbox.env);
		expect(again.stdout).toBe("done      Not signed in\n");
	});

	describe("an expired token that cannot refresh", () => {
		function writeExpired(authUrl: string): string {
			const dir = join(sandbox.home, ".config", "tripwire");
			mkdirSync(dir, { recursive: true });
			const file = join(dir, "credentials.json");
			writeFileSync(
				file,
				JSON.stringify({
					accessToken: "old",
					refreshToken: "rt",
					expiresAt: 1,
					mcpUrl: server.url,
					authUrl,
				}),
				{ mode: 0o600 },
			);
			return file;
		}

		async function withAuth(
			status: number,
			body: string,
			check: (result: Awaited<ReturnType<typeof runCli>>, file: string) => void,
		) {
			const auth = Bun.serve({
				port: 0,
				fetch: () => new Response(body, { status }),
			});
			try {
				const file = writeExpired(`http://127.0.0.1:${auth.port}`);
				const before = readFileSync(file, "utf8");
				const { TRIPWIRE_TOKEN: _drop, ...rest } = env();
				const result = await runCli(["whoami"], rest);
				check(result, file);
				expect(readFileSync(file, "utf8")).toBe(before);
			} finally {
				await auth.stop(true);
			}
		}

		test("a 5xx from the auth server says unreachable", async () => {
			await withAuth(
				503,
				JSON.stringify({
					error: { code: "err:frontline:capacity:no_running_instances" },
				}),
				(result) => {
					expect(result.code).toBe(1);
					expect(result.stderr).toBe(
						"error     Tripwire is not reachable right now. Try again in a minute.\n",
					);
				},
			);
		});

		test("an OAuth invalid_grant says the session expired", async () => {
			await withAuth(
				400,
				JSON.stringify({ error: "invalid_grant" }),
				(result) => {
					expect(result.code).toBe(1);
					expect(result.stderr).toBe(
						"error     Session expired. Run tripwire login.\n",
					);
				},
			);
		});
	});
});

describe("workflows as code", () => {
	const file = () => join(sandbox.root, "tripwire.ts");

	async function pulled() {
		const result = await runCli(
			["workflows", "pull", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		return result;
	}

	test("pull writes tripwire.ts and the typed helpers beside it", async () => {
		const result = await pulled();
		expect(result.stdout).toContain("(1 workflow)");
		const code = readFileSync(file(), "utf8");
		expect(code).toContain('from "./.tripwire/workflow.ts"');
		expect(code).toContain('check("account-age", {');
		expect(code).toContain('"new-accounts": newAccounts(),');
		const helpers = readFileSync(
			join(sandbox.root, ".tripwire", "workflow.ts"),
			"utf8",
		);
		expect(helpers).toContain("export interface TripwireCatalog");
		expect(helpers).toContain("} = authoring<TripwireCatalog>();");
	});

	test("pull refuses to replace local edits without --force", async () => {
		await pulled();
		writeFileSync(file(), `${readFileSync(file(), "utf8")}\n`);
		const again = await runCli(
			["workflows", "pull", "scratch", "--file", file()],
			env(),
		);
		expect(again.code).toBe(1);
		expect(again.stderr).toContain("Pass --force");
	});

	test("validate compiles the pulled file and says it can be turned on", async () => {
		await pulled();
		const result = await runCli(
			["workflows", "validate", "--file", file()],
			env(),
		);
		expect(result.stdout).toContain("new-accounts can be turned on");
		expect(result.code).toBe(0);
	});

	test("validate points a wrong rule id at the right one", async () => {
		await pulled();
		writeFileSync(
			file(),
			readFileSync(file(), "utf8").replace('"account-age"', '"acount-age"'),
		);
		const result = await runCli(
			["workflows", "validate", "--file", file()],
			env(),
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			"acount-age is not a rule. Did you mean account-age?",
		);
	});

	test("validate still reports the workflows that compile when one does not", async () => {
		await pulled();
		writeFileSync(
			file(),
			`import { block, check, trigger, workflow, workflows } from "./.tripwire/workflow.ts";

function broken() {
	const t = trigger("change-request.opened");
	const age = check("acount-age", { minDays: 7 }).after(t);
	return workflow({ name: "Broken", steps: { t, age, stop: block().after(age.fails) } });
}

function loose() {
	const t = trigger("change-request.opened");
	const age = check("account-age", { minDays: 7 }).after(t);
	const spare = check("account-age", { minDays: 30 }).after(t);
	return workflow({
		name: "Loose",
		steps: { t, age, spare, stop: block().after(age.fails) },
	});
}

export default workflows({ broken: broken(), loose: loose() });
`,
		);
		const result = await runCli(
			["workflows", "validate", "--file", file()],
			env(),
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			"acount-age is not a rule. Did you mean account-age?",
		);
		expect(result.stdout).toContain("loose can be turned on");
		expect(result.stdout).toContain("Account age 2: Nothing runs after it.");
		expect(result.stdout).not.toContain("broken can be turned on");

		const json = await runCli(
			["--json", "workflows", "validate", "--file", file()],
			env(),
		);
		expect(json.code).toBe(1);
		const parsed = JSON.parse(json.stdout);
		expect(parsed.valid).toBe(false);
		expect(parsed.issues[0].workflow).toBe("broken");
		expect(parsed.workflows.map((w: { id: string }) => w.id)).toEqual([
			"loose",
		]);
	});

	test("validate reads a schedule back with what it finds and what it does", async () => {
		await pulled();
		writeFileSync(
			file(),
			`import { close, schedule, workflow, workflows } from "./.tripwire/workflow.ts";

const nightly = schedule({
	every: { cron: "*/15 * * * *" },
	timezone: "Europe/Berlin",
	match: {
		subjects: ["issue"],
		state: "open",
		inactiveFor: { n: 3, unit: "weeks" },
		labels: ["needs-info"],
	},
});

export default workflows({
	stale: workflow({ on: nightly, run: [close()] }),
});
`,
		);
		const result = await runCli(
			["workflows", "validate", "--file", file()],
			env(),
		);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain(
			"schedule: Every 15 minutes (Europe/Berlin), finds open issues with no activity for 3 weeks, labeled needs-info, skipping locked ones. Then Tripwire closes it.",
		);
	});

	test("a wrong id also fails type-checking with the right one named", async () => {
		await pulled();
		writeFileSync(
			file(),
			readFileSync(file(), "utf8")
				.replace('"account-age"', '"acount-age"')
				.replace("minDays:", "minDayz:"),
		);
		const tsc = Bun.spawnSync(
			[
				process.execPath,
				"x",
				"tsc",
				"--noEmit",
				"--strict",
				"--target",
				"es2022",
				"--module",
				"esnext",
				"--moduleResolution",
				"bundler",
				"--allowImportingTsExtensions",
				file(),
			],
			{ cwd: join(import.meta.dir, "..") },
		);
		const output = tsc.stdout.toString();
		expect(output).toContain('"acount-age is not a rule, try account-age"');
	});

	test("diff lists what a push would change", async () => {
		await pulled();
		const result = await runCli(
			["workflows", "diff", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("~ step account-age.minDays: 7 → 14");
		const call = server.calls.find(
			(entry) => entry.name === "validate_workflow",
		);
		expect(call?.args).toMatchObject({
			repo: "scratch",
			definitions: [{ id: "new-accounts", name: "New accounts" }],
		});
	});

	test("push sends the compiled definitions to apply_workflow", async () => {
		await pulled();
		const result = await runCli(
			["workflows", "push", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("new-accounts  updated");
		const call = server.calls.find((entry) => entry.name === "apply_workflow");
		expect(call?.args).toMatchObject({
			repo: "scratch",
			definitions: [
				{
					id: "new-accounts",
					edges: [
						{ from: "trigger", to: "account-age" },
						{ from: "account-age", to: "block", when: "fail" },
					],
				},
			],
		});
	});

	test("a refused push says why, step by step", async () => {
		await pulled();
		server.answerNext("apply_workflow", {
			workflows: [
				{
					id: "new-accounts",
					outcome: "refused",
					issues: ["Any of: It takes no inputs.", "Block: Nothing runs it."],
				},
			],
		});
		const result = await runCli(
			["workflows", "push", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			"new-accounts is on, so this version was not saved. Any of: It takes no inputs. Block: Nothing runs it.",
		);
	});

	test("diff warns when the pushed workflow could not be turned on", async () => {
		await pulled();
		const report = {
			id: "new-accounts",
			name: "New accounts",
			valid: false,
			issues: [
				{
					rule: "gate-input",
					severity: "error",
					step: "Any of",
					message: "It takes no inputs.",
				},
			],
			schedules: [],
			changes: [],
		};
		server.answerNext("validate_workflow", {
			valid: false,
			workflows: [{ ...report, enabled: true }],
		});
		const live = await runCli(
			["workflows", "diff", "scratch", "--file", file()],
			env(),
		);
		expect(live.stderr).toContain(
			"new-accounts is on, so a push will be refused. Any of: It takes no inputs.",
		);
		server.answerNext("validate_workflow", {
			valid: false,
			workflows: [{ ...report, enabled: false }],
		});
		const off = await runCli(
			["workflows", "diff", "scratch", "--file", file()],
			env(),
		);
		expect(off.stderr).toContain(
			"new-accounts could not be turned on after a push. Any of: It takes no inputs.",
		);
	});
});

describe("the workflows skill", () => {
	test("its reference example validates as written", async () => {
		const skill = readFileSync(
			join(import.meta.dir, "..", "skills", "tripwire-workflows", "SKILL.md"),
			"utf8",
		);
		const example = /```ts\n([\s\S]*?)```/.exec(skill)?.[1] ?? "";
		const file = join(sandbox.root, "tripwire.ts");
		writeFileSync(file, example);
		const result = await runCli(
			["workflows", "validate", "--file", file],
			env(),
		);
		expect(result.stdout).toContain("change-request-opens can be turned on");
		expect(result.code).toBe(0);
	});
});

describe("local validate and custom rules", () => {
	test("a custom rule passes locally and is checked for real with --repo", async () => {
		await runCli(
			[
				"workflows",
				"pull",
				"scratch",
				"--file",
				join(sandbox.root, "tripwire.ts"),
			],
			env(),
		);
		const file = join(sandbox.root, "tripwire.ts");
		writeFileSync(
			file,
			readFileSync(file, "utf8")
				.replace(
					'check("account-age", {\n\t\tminDays: 7,\n\t})',
					'customCheck("custom-no-newbs-01a15e")',
				)
				.replace("import {\n", "import {\n\tcustomCheck,\n"),
		);
		expect(readFileSync(file, "utf8")).toContain(
			'customCheck("custom-no-newbs-01a15e")',
		);
		const result = await runCli(
			["workflows", "validate", "--file", file],
			env(),
		);
		expect(result.stdout).toContain("new-accounts can be turned on");
		expect(result.code).toBe(0);
	});
});
