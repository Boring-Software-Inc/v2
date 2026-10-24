import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDefinition } from "@tripwire/contracts";
import { z } from "zod";
import { type FakeServer, startFakeServer, TEST_TOKEN } from "./fake-server";
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

function env() {
	return {
		...sandbox.env,
		TRIPWIRE_MCP_URL: server.url,
		TRIPWIRE_TOKEN: TEST_TOKEN,
		TRIPWIRE_NO_BROWSER: "1",
	};
}

const UUID_A = "01a16cb7-c784-73d9-8b54-6d7c1959b95f";
const UUID_B = "01a16cb7-c786-7000-8000-000000000002";

function blockCrypto(
	id: string,
	name: string,
	minDays = 7,
): WorkflowDefinition {
	return {
		id,
		name,
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{
				id: "age",
				type: "rule",
				ref: "account-age@1",
				config: { minDays },
			},
			{ id: "stop", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "age" },
			{ id: "e2", from: "age", to: "stop", when: "fail" },
		],
	};
}

function serve(definitions: WorkflowDefinition[]) {
	const payload = {
		code: "",
		warnings: [],
		workflows: definitions.map((definition) => ({
			id: definition.id,
			appId: `app-${definition.id}`,
			name: definition.name,
			enabled: false,
			definition,
		})),
	};
	server.answerNext("get_workflow", z.json().parse(payload));
}

const TWIN_A = blockCrypto(UUID_A, "Block crypto pushes");
const TWIN_B = blockCrypto(UUID_B, "Block crypto pushes");
const TWINS = [TWIN_A, TWIN_B];

const file = () => join(project, "tripwire.ts");
const linkPath = () => join(project, ".tripwire", "project.json");
const readLink = () => JSON.parse(readFileSync(linkPath(), "utf8"));

const sentSchema = z.object({
	definitions: z.array(z.object({ id: z.string() })),
});

function sentIds(tool: string): string[] {
	const call = [...server.calls].reverse().find((entry) => entry.name === tool);
	return sentSchema.parse(call?.args).definitions.map((item) => item.id);
}

async function pullTwins() {
	serve(TWINS);
	const result = await runCli(
		["workflows", "pull", "scratch", "--yes"],
		env(),
		project,
	);
	expect(result.code).toBe(0);
	return result;
}

describe("workflow keys in tripwire.ts", () => {
	test("pull writes readable keys and saves each key's id", async () => {
		await pullTwins();
		const code = readFileSync(file(), "utf8");
		expect(code).toContain('\t"block-crypto-pushes": blockCryptoPushes(),');
		expect(code).toContain('\t"block-crypto-pushes-2": blockCryptoPushes2(),');
		expect(code).not.toContain(UUID_A);
		expect(readLink().workflows).toEqual({
			"block-crypto-pushes": UUID_A,
			"block-crypto-pushes-2": UUID_B,
		});
	});

	test("diff and push send the saved ids, with no extra lookup", async () => {
		await pullTwins();
		server.calls.length = 0;
		const diff = await runCli(["workflows", "diff"], env(), project);
		expect(diff.code).toBe(0);
		expect(server.calls.map((call) => call.name)).toEqual([
			"validate_workflow",
		]);
		expect(sentIds("validate_workflow")).toEqual([UUID_A, UUID_B]);
		const push = await runCli(["workflows", "push", "--force"], env(), project);
		expect(push.code).toBe(0);
		expect(sentIds("apply_workflow")).toEqual([UUID_A, UUID_B]);
	});

	test("pull, push, pull changes nothing", async () => {
		await pullTwins();
		const first = readFileSync(file(), "utf8");
		const link = readFileSync(linkPath(), "utf8");
		await runCli(["workflows", "push"], env(), project);
		await runCli(["workflows", "push", "--force"], env(), project);
		const again = await pullTwins();
		expect(readFileSync(file(), "utf8")).toBe(first);
		expect(readFileSync(linkPath(), "utf8")).toBe(link);
		expect(again.stdout).not.toContain("linked");
	});

	test("a rename on the server keeps the key, so nothing doubles", async () => {
		await pullTwins();
		serve([blockCrypto(UUID_A, "Block coins"), TWIN_B]);
		const result = await runCli(
			["workflows", "pull", "--yes", "--force"],
			env(),
			project,
		);
		expect(result.code).toBe(0);
		const code = readFileSync(file(), "utf8");
		expect(code).toContain('\t"block-crypto-pushes": blockCoins(),');
		expect(code).toContain('name: "Block coins",');
		expect(readLink().workflows["block-crypto-pushes"]).toBe(UUID_A);
	});

	test("a rename in the file keeps the key and the id", async () => {
		await pullTwins();
		writeFileSync(
			file(),
			readFileSync(file(), "utf8").replace(
				'name: "Block crypto pushes",',
				'name: "Block coins",',
			),
		);
		await runCli(["workflows", "push", "--force"], env(), project);
		expect(sentIds("apply_workflow")).toEqual([UUID_A, UUID_B]);
	});

	test("with the ids gone, keys match the server by name and say so", async () => {
		await pullTwins();
		writeFileSync(linkPath(), JSON.stringify({ repo: "scratch" }));
		serve(TWINS);
		const result = await runCli(["workflows", "diff"], env(), project);
		expect(result.code).toBe(0);
		expect(sentIds("validate_workflow")).toEqual([UUID_A, UUID_B]);
		expect(result.stderr).toContain(
			"block-crypto-pushes has no saved id in .tripwire/project.json, so it matches Block crypto pushes on the server by its name.",
		);
	});

	test("a key that matches nothing is a new workflow, and push saves its id", async () => {
		await pullTwins();
		writeFileSync(
			file(),
			readFileSync(file(), "utf8").replace(
				'"block-crypto-pushes-2": blockCryptoPushes2()',
				'"my-block": blockCryptoPushes2()',
			),
		);
		serve(TWINS);
		const result = await runCli(
			["workflows", "push", "--force"],
			env(),
			project,
		);
		expect(result.code).toBe(0);
		expect(sentIds("apply_workflow")).toEqual([UUID_A, "my-block"]);
		expect(readLink().workflows).toEqual({
			"block-crypto-pushes": UUID_A,
			"block-crypto-pushes-2": UUID_B,
			"my-block": "my-block",
		});
	});

	test("an accepted review saves the ids too", async () => {
		await pullTwins();
		writeFileSync(linkPath(), JSON.stringify({ repo: "scratch" }));
		serve(TWINS);
		const result = await runCli(["workflows", "push"], env(), project);
		expect(result.code).toBe(0);
		expect(sentIds("propose_workflow_push")).toEqual([UUID_A, UUID_B]);
		expect(readLink().workflows).toEqual({
			"block-crypto-pushes": UUID_A,
			"block-crypto-pushes-2": UUID_B,
		});
	});

	test("pull takes a workflow by its key", async () => {
		serve(TWINS);
		const result = await runCli(
			["workflows", "pull", "scratch", "block-crypto-pushes-2"],
			env(),
			project,
		);
		expect(result.code).toBe(0);
		expect(readLink().workflows).toEqual({
			"block-crypto-pushes-2": UUID_B,
		});
	});
});
