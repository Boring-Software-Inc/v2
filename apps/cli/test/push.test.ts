import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { join } from "node:path";
import {
	cannedResult,
	type FakeServer,
	startFakeServer,
	TEST_TOKEN,
} from "./fake-server";
import { makeSandbox, runCli, type Sandbox } from "./sandbox";

const REVIEW_URL =
	"https://app.tripwire.sh/grim/scratch/workflows/review/push-1";

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
	sandbox.addBinary("open", 'printf "%s\\n" "open $*" >> "$ARGV_LOG"');
	sandbox.addBinary("xdg-open", 'printf "%s\\n" "open $*" >> "$ARGV_LOG"');
	server.calls.length = 0;
});

afterEach(() => sandbox.cleanup());

function env(extra: Record<string, string> = {}) {
	return {
		...sandbox.env,
		TRIPWIRE_MCP_URL: server.url,
		TRIPWIRE_TOKEN: TEST_TOKEN,
		DISPLAY: ":0",
		...extra,
	};
}

const file = () => join(sandbox.root, "tripwire.ts");

async function pulled() {
	const result = await runCli(
		["workflows", "pull", "scratch", "--file", file()],
		env(),
	);
	expect(result.code).toBe(0);
}

function pending() {
	const canned = cannedResult("get_workflow_push");
	return { ...(canned as object), status: "pending" };
}

function called(name: string) {
	return server.calls.filter((entry) => entry.name === name);
}

describe("workflows push sends tripwire.ts for review", () => {
	test("opens the review page, waits for the accept and prints each outcome", async () => {
		await pulled();
		server.answerNext("get_workflow_push", pending());
		const result = await runCli(
			["workflows", "push", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stderr).toContain(`review    ${REVIEW_URL}`);
		expect(result.stderr).toContain(
			"Waiting for someone to accept 1 workflow on grim/scratch",
		);
		expect(result.stdout).toBe(
			"updated   new-accounts  https://app.tripwire.sh/grim/scratch/workflows/w1\n",
		);
		expect(sandbox.argv()).toEqual([`open ${REVIEW_URL}`]);
		expect(called("apply_workflow")).toEqual([]);
		expect(called("propose_workflow_push")[0]?.args).toMatchObject({
			repo: "scratch",
			definitions: [{ id: "new-accounts" }],
		});
		expect(called("get_workflow_push").map((entry) => entry.args)).toEqual([
			{ org: "grim", push: "push-1", waitSeconds: 25 },
			{ org: "grim", push: "push-1", waitSeconds: 25 },
		]);
	});

	test("--no-browser prints the link and opens nothing", async () => {
		await pulled();
		const result = await runCli(
			["workflows", "push", "scratch", "--no-browser", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stderr).toContain(REVIEW_URL);
		expect(sandbox.argv()).toEqual([]);
	});

	test("CI and TRIPWIRE_NO_BROWSER print the link and open nothing", async () => {
		await pulled();
		const extras: Record<string, string>[] = [
			{ CI: "true" },
			{ TRIPWIRE_NO_BROWSER: "1" },
		];
		for (const extra of extras) {
			const result = await runCli(
				["workflows", "push", "scratch", "--file", file()],
				env(extra),
			);
			expect(result.code).toBe(0);
			expect(result.stderr).toContain(REVIEW_URL);
		}
		expect(sandbox.argv()).toEqual([]);
	});

	for (const [status, line] of [
		["rejected", "The push was declined. Nothing was saved."],
		["expired", "The review link expired. Nothing was saved. Push again."],
		[
			"stale",
			"These workflows changed on the server after the push. Nothing was saved. Run tripwire workflows diff scratch, then push again.",
		],
	] as const) {
		test(`a ${status} push exits 1 and says nothing was saved`, async () => {
			await pulled();
			server.answerNext("get_workflow_push", { ...pending(), status });
			const result = await runCli(
				["workflows", "push", "scratch", "--no-browser", "--file", file()],
				env(),
			);
			expect(result.code).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(`error     ${line}`);
		});
	}

	test("nothing to push says so and exits 0 without a review", async () => {
		await pulled();
		server.answerNext("propose_workflow_push", { result: "unchanged" });
		const result = await runCli(
			["workflows", "push", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("done      No changes to push\n");
		expect(called("get_workflow_push")).toEqual([]);
		expect(sandbox.argv()).toEqual([]);
	});

	test("a workflow that would break a live one is refused before any review", async () => {
		await pulled();
		server.answerNext("propose_workflow_push", {
			result: "blocked",
			workflows: [
				{
					id: "new-accounts",
					name: "New accounts",
					issues: ["Any of: It takes no inputs."],
				},
			],
		});
		const result = await runCli(
			["workflows", "push", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toBe(
			"error     New accounts was not sent for review. Any of: It takes no inputs.\n",
		);
		expect(sandbox.argv()).toEqual([]);
	});

	test("--json prints the review link and does not wait", async () => {
		await pulled();
		const result = await runCli(
			["--json", "workflows", "push", "scratch", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			id: "push-1",
			status: "pending",
			url: REVIEW_URL,
		});
		expect(called("get_workflow_push")).toEqual([]);
		expect(sandbox.argv()).toEqual([]);
	});

	test("--json --wait prints the decided push and exits by its status", async () => {
		await pulled();
		server.answerNext("get_workflow_push", {
			...pending(),
			status: "rejected",
		});
		const result = await runCli(
			[
				"--json",
				"workflows",
				"push",
				"scratch",
				"--wait",
				"--no-browser",
				"--file",
				file(),
			],
			env(),
		);
		expect(result.code).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({ status: "rejected" });
		expect(result.stderr).toBe("");
	});

	test("--force saves at once through apply_workflow", async () => {
		await pulled();
		const result = await runCli(
			["workflows", "push", "scratch", "--force", "--file", file()],
			env(),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("new-accounts  updated");
		expect(called("apply_workflow")).toHaveLength(1);
		expect(called("propose_workflow_push")).toEqual([]);
		expect(sandbox.argv()).toEqual([]);
	});
});
