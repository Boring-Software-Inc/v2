import { describe, expect, test } from "bun:test";
import type { Agent, LoginCommand, SignInState } from "#/agents/types";
import { planSignIns, runSignIns, type SignInPlan } from "#/sign-in";
import type { RunResult } from "#/system";

function login(states: SignInState[]): LoginCommand & { probes: number } {
	const command = {
		command: "agent-cli",
		args: ["mcp", "login", "tripwire"],
		probes: 0,
		status: async () => {
			const state = states[Math.min(command.probes, states.length - 1)];
			command.probes += 1;
			return state ?? "unknown";
		},
	};
	return command;
}

function agent(id: string, command: LoginCommand | null): Agent {
	return {
		id,
		name: id,
		signInHint: `${id} hint`,
		detect: () => true,
		hasServer: async () => true,
		addServer: async () => ({ target: id, outcome: "unchanged" }),
		skillsDirs: () => [],
		login: () => command,
	};
}

const ok: RunResult = { ok: true, stdout: "", stderr: "" };
const failed: RunResult = { ok: false, stdout: "", stderr: "" };

describe("planSignIns", () => {
	test("signs in only the agents that need it", async () => {
		const plans = await planSignIns([
			agent("claude", login(["signed-out"])),
			agent("opencode", login(["signed-in"])),
			agent("muse", login(["unknown"])),
			agent("cursor", null),
		]);
		expect(plans.map((plan) => [plan.agent.id, plan.kind])).toEqual([
			["claude", "run"],
			["opencode", "signed-in"],
			["muse", "run"],
			["cursor", "manual"],
		]);
	});

	test("a status check that throws counts as unknown, so the login still runs", async () => {
		const broken: LoginCommand = {
			command: "x",
			args: [],
			status: async () => {
				throw new Error("boom");
			},
		};
		const plans = await planSignIns([agent("claude", broken)]);
		expect(plans.map((plan) => plan.kind)).toEqual(["run"]);
	});
});

describe("runSignIns", () => {
	function plan(id: string, states: SignInState[]): SignInPlan {
		const command = login(states);
		return { kind: "run", agent: agent(id, command), login: command };
	}

	test("runs every login in order and checks the result again", async () => {
		const ran: string[] = [];
		const results = await runSignIns(
			[plan("claude", ["signed-in"]), plan("opencode", ["signed-in"])],
			async (entry) => {
				ran.push(entry.agent.id);
				return ok;
			},
		);
		expect(ran).toEqual(["claude", "opencode"]);
		expect(results.map((result) => result.outcome)).toEqual([
			"signed-in",
			"signed-in",
		]);
	});

	test("one failing login does not stop the next", async () => {
		const ran: string[] = [];
		const results = await runSignIns(
			[
				plan("claude", ["signed-out"]),
				plan("codex", ["signed-out"]),
				plan("opencode", ["signed-in"]),
			],
			async (entry) => {
				ran.push(entry.agent.id);
				if (entry.agent.id === "codex") {
					throw new Error("spawn codex ENOENT");
				}
				return entry.agent.id === "claude" ? failed : ok;
			},
		);
		expect(ran).toEqual(["claude", "codex", "opencode"]);
		expect(results.map((result) => [result.agent.id, result.outcome])).toEqual([
			["claude", "failed"],
			["codex", "failed"],
			["opencode", "signed-in"],
		]);
	});

	test("a login that exits 0 but leaves the agent signed out failed", async () => {
		const [result] = await runSignIns(
			[plan("opencode", ["signed-out"])],
			async () => ok,
		);
		expect(result?.outcome).toBe("failed");
	});

	test("when the agent cannot report sign-in, the exit code decides", async () => {
		const results = await runSignIns(
			[plan("muse", ["unknown"]), plan("other", ["unknown"])],
			async (entry) => (entry.agent.id === "muse" ? ok : failed),
		);
		expect(results.map((result) => result.outcome)).toEqual([
			"signed-in",
			"failed",
		]);
	});

	test("agents already signed in and manual agents pass through without a run", async () => {
		let runs = 0;
		const results = await runSignIns(
			[
				{ kind: "signed-in", agent: agent("opencode", null) },
				{ kind: "manual", agent: agent("cursor", null) },
			],
			async () => {
				runs += 1;
				return ok;
			},
		);
		expect(runs).toBe(0);
		expect(results.map((result) => result.outcome)).toEqual([
			"already",
			"manual",
		]);
	});
});
