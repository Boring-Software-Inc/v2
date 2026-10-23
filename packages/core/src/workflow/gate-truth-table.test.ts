import { describe, expect, test } from "bun:test";
import type {
	EdgeWhen,
	GateMode,
	NormalizedEvent,
	RuleResult,
	WorkflowDefinition,
} from "@tripwire/contracts";
import { validateWorkflow } from "@tripwire/contracts";
import { fixtureEvent } from "../rules/test-context.ts";
import { executeWorkflow } from "./executor.ts";

type InputState = "passes" | "fails" | "skipped" | "errored";
type InputPort = "pass" | "fail";

const STATES: readonly InputState[] = ["passes", "fails", "skipped", "errored"];
const PORTS: readonly InputPort[] = ["pass", "fail"];

function resultFor(ref: string, state: InputState): RuleResult {
	const base = {
		ruleId: ref.split("@")[0] ?? ref,
		version: 1,
		evidence: {},
		evaluatedAt: "2026-10-23T00:00:00.000Z",
	};
	if (state === "skipped") {
		return { ...base, status: "skipped", passed: false, reason: "no data" };
	}
	if (state === "errored") {
		return {
			...base,
			status: "skipped",
			passed: false,
			reason: "rule threw: boom",
		};
	}
	return { ...base, status: "evaluated", passed: state === "passes" };
}

/**
 * The oracle, written apart from the executor. A rule that cannot evaluate is
 * unknown, so the oracle tries it both ways: the gate passes or fails only
 * when every possible world agrees, and is skipped otherwise.
 */
function possibleInputs(state: InputState, port: InputPort): boolean[] {
	const worlds =
		state === "passes" ? [true] : state === "fails" ? [false] : [true, false];
	return worlds.map((passed) => (port === "pass" ? passed : !passed));
}

function plainGate(mode: GateMode, inputs: readonly boolean[]): boolean {
	if (mode === "all-of") {
		return inputs.every(Boolean);
	}
	if (mode === "any-of") {
		return inputs.some(Boolean);
	}
	return !inputs[0];
}

function worlds(choices: readonly boolean[][]): boolean[][] {
	const [first, ...rest] = choices;
	if (!first) {
		return [[]];
	}
	return first.flatMap((value) => worlds(rest).map((tail) => [value, ...tail]));
}

function expectedGate(
	mode: GateMode,
	wires: readonly Wire[],
): "pass" | "fail" | "skipped" {
	const answers = new Set(
		worlds(wires.map((wire) => possibleInputs(wire.state, wire.port))).map(
			(inputs) => plainGate(mode, inputs),
		),
	);
	if (answers.size > 1) {
		return "skipped";
	}
	return answers.has(true) ? "pass" : "fail";
}

interface Wire {
	state: InputState;
	port: InputPort;
}

function gateGraph(mode: GateMode, wires: readonly Wire[]): WorkflowDefinition {
	const rules = wires.map((_, index) => `r${index}`);
	return {
		id: "truth",
		name: "truth",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			...rules.map((id) => ({
				id,
				type: "rule" as const,
				ref: `${id}@1`,
				config: {},
			})),
			{ id: "g", type: "gate", mode },
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			...rules.map((id) => ({ id: `t-${id}`, from: "t", to: id })),
			...wires.map((wire, index) => {
				const when: EdgeWhen | undefined =
					wire.port === "fail" ? "fail" : undefined;
				return when
					? { id: `in-${index}`, from: `r${index}`, to: "g", when }
					: { id: `in-${index}`, from: `r${index}`, to: "g" };
			}),
			{ id: "out", from: "g", to: "block" },
		],
	};
}

function combinations(size: number): Wire[][] {
	if (size === 0) {
		return [[]];
	}
	return combinations(size - 1).flatMap((rest) =>
		STATES.flatMap((state) => PORTS.map((port) => [{ state, port }, ...rest])),
	);
}

async function runGate(
	event: NormalizedEvent,
	mode: GateMode,
	wires: readonly Wire[],
) {
	const definition = gateGraph(mode, wires);
	const states = new Map(
		wires.map((wire, index) => [`r${index}@1`, wire.state]),
	);
	let tick = 0;
	return await executeWorkflow({
		definition,
		event,
		evaluateRuleRef: (ref) =>
			Promise.resolve(resultFor(ref, states.get(ref) ?? "passes")),
		now: () => new Date(1_760_000_000_000 + tick++).toISOString(),
	});
}

function label(wires: readonly Wire[]): string {
	return wires
		.map(
			(wire) =>
				`${wire.state} via ${wire.port === "pass" ? "Passes" : "Doesn't pass"}`,
		)
		.join(", ");
}

describe("gate truth tables", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	for (const mode of ["all-of", "any-of"] as const) {
		for (const size of [1, 2, 3]) {
			test(`${mode} over ${size} inputs, every state and port`, async () => {
				for (const wires of combinations(size)) {
					const result = await runGate(event, mode, wires);
					const gate = result.steps.find((step) => step.nodeId === "g");
					const want = expectedGate(mode, wires);
					expect({ wires: label(wires), gate: gate?.status }).toEqual({
						wires: label(wires),
						gate: want,
					});
					expect({ wires: label(wires), verdict: result.verdict }).toEqual({
						wires: label(wires),
						verdict: want === "pass" ? "block" : "pass",
					});
				}
			});
		}
	}

	test("not over one input, every state and port", async () => {
		for (const wires of combinations(1)) {
			const result = await runGate(event, "not", wires);
			const gate = result.steps.find((step) => step.nodeId === "g");
			const want = expectedGate("not", wires);
			expect({ wires: label(wires), gate: gate?.status }).toEqual({
				wires: label(wires),
				gate: want,
			});
		}
	});

	test("every graph in the tables is valid", () => {
		for (const mode of ["all-of", "any-of"] as const) {
			for (const wires of combinations(2)) {
				expect(validateWorkflow(gateGraph(mode, wires)).valid).toBe(true);
			}
		}
		for (const wires of combinations(1)) {
			expect(validateWorkflow(gateGraph("not", wires)).valid).toBe(true);
		}
	});

	test("the gate records which port each input came through", async () => {
		const result = await runGate(event, "any-of", [
			{ state: "fails", port: "fail" },
			{ state: "passes", port: "pass" },
		]);
		const gate = result.steps.find((step) => step.nodeId === "g");
		expect(gate?.input).toEqual({
			mode: "any-of",
			inputs: [
				{ from: "r0", port: "fail", outcome: "pass" },
				{ from: "r1", port: "pass", outcome: "pass" },
			],
		});
	});
});

describe("regression: Doesn't pass into a gate", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	test("if any of these doesn't pass, block: one failing rule blocks", async () => {
		const result = await runGate(event, "any-of", [
			{ state: "passes", port: "fail" },
			{ state: "fails", port: "fail" },
		]);
		expect(result.verdict).toBe("block");
	});

	test("if any of these doesn't pass, block: all passing rules do not block", async () => {
		const result = await runGate(event, "any-of", [
			{ state: "passes", port: "fail" },
			{ state: "passes", port: "fail" },
		]);
		expect(result.verdict).toBe("pass");
	});

	test("a rule that cannot evaluate never blocks through Doesn't pass", async () => {
		for (const state of ["skipped", "errored"] as const) {
			const result = await runGate(event, "any-of", [{ state, port: "fail" }]);
			expect(result.verdict).toBe("pass");
		}
	});

	test("Doesn't pass into any-of equals Passes through Not into any-of", async () => {
		for (const state of STATES) {
			const direct = await runGate(event, "any-of", [{ state, port: "fail" }]);
			const viaNot = await runGate(event, "not", [{ state, port: "pass" }]);
			expect(direct.verdict).toBe(viaNot.verdict);
		}
	});
});

describe("regression: a rule that cannot run behind a Not", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	const definition: WorkflowDefinition = {
		id: "not-chain",
		name: "not-chain",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "r@1", config: {} },
			{ id: "not", type: "gate", mode: "not" },
			{ id: "all", type: "gate", mode: "all-of" },
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "not" },
			{ id: "e3", from: "not", to: "all" },
			{ id: "e4", from: "all", to: "block", when: "fail" },
		],
	};

	test("never blocks, whatever the negations", async () => {
		for (const state of ["skipped", "errored"] as const) {
			const result = await executeWorkflow({
				definition,
				event,
				evaluateRuleRef: (ref) => Promise.resolve(resultFor(ref, state)),
				now: () => "2026-10-23T00:00:00.000Z",
			});
			expect(result.verdict).toBe("pass");
			expect(result.steps.map((step) => [step.nodeId, step.status])).toEqual([
				["t", "pass"],
				["r", "skipped"],
				["not", "skipped"],
				["all", "skipped"],
				["block", "skipped"],
			]);
		}
	});

	test("still blocks when the rule ran and passed", async () => {
		const result = await executeWorkflow({
			definition,
			event,
			evaluateRuleRef: (ref) => Promise.resolve(resultFor(ref, "passes")),
			now: () => "2026-10-23T00:00:00.000Z",
		});
		expect(result.verdict).toBe("block");
	});
});

describe("unreached inputs", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	function chained(
		mode: GateMode,
		outputs: { id: string; when?: EdgeWhen; action: "block" | "label" }[],
	): WorkflowDefinition {
		return {
			id: "chained",
			name: "chained",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "a", type: "rule", ref: "a@1", config: {} },
				{ id: "b", type: "rule", ref: "b@1", config: {} },
				{ id: "c", type: "rule", ref: "c@1", config: {} },
				{ id: "g", type: "gate", mode },
				...outputs.map((output) =>
					output.action === "label"
						? {
								id: output.id,
								type: "action" as const,
								action: "label" as const,
								params: { labels: ["trusted"] },
							}
						: {
								id: output.id,
								type: "action" as const,
								action: "block" as const,
							},
				),
			],
			edges: [
				{ id: "e1", from: "t", to: "a" },
				{ id: "e2", from: "a", to: "b" },
				{ id: "e3", from: "t", to: "c" },
				{ id: "e4", from: "b", to: "g" },
				{ id: "e5", from: "c", to: "g" },
				...outputs.map((output) =>
					output.when
						? {
								id: `out-${output.id}`,
								from: "g",
								to: output.id,
								when: output.when,
							}
						: { id: `out-${output.id}`, from: "g", to: output.id },
				),
			],
		};
	}

	async function run(
		definition: WorkflowDefinition,
		states: Record<string, InputState>,
	) {
		return await executeWorkflow({
			definition,
			event,
			evaluateRuleRef: (ref) =>
				Promise.resolve(resultFor(ref, states[ref] ?? "passes")),
			now: () => "2026-10-23T00:00:00.000Z",
		});
	}

	test("an input unreached behind a skipped rule is unknown, so block never fires", async () => {
		const definition = chained("any-of", [
			{ id: "block", when: "fail", action: "block" },
		]);
		for (const state of ["skipped", "errored"] as const) {
			const result = await run(definition, { "a@1": state, "c@1": "fails" });
			expect(result.steps.find((step) => step.nodeId === "b")?.status).toBe(
				"skipped",
			);
			expect(result.steps.find((step) => step.nodeId === "g")?.status).toBe(
				"skipped",
			);
			expect(result.verdict).toBe("pass");
			expect(result.actions).toEqual([]);
		}
	});

	test("an input unreached behind a skipped rule never lets all-of pass", async () => {
		const definition = chained("all-of", [{ id: "lab", action: "label" }]);
		const result = await run(definition, { "a@1": "skipped", "c@1": "passes" });
		expect(result.steps.find((step) => step.nodeId === "g")?.status).toBe(
			"skipped",
		);
		expect(result.actions).toEqual([]);
	});

	test("an input its branch certainly never reached does not pass", async () => {
		const blocking = chained("any-of", [
			{ id: "block", when: "fail", action: "block" },
		]);
		const result = await run(blocking, { "a@1": "fails", "c@1": "fails" });
		const gate = result.steps.find((step) => step.nodeId === "g");
		expect(gate?.input).toEqual({
			mode: "any-of",
			inputs: [
				{ from: "b", port: "pass", outcome: "fail", reached: false },
				{ from: "c", port: "pass", outcome: "fail" },
			],
		});
		expect(gate?.status).toBe("fail");
		expect(result.verdict).toBe("block");

		const labelling = chained("all-of", [{ id: "lab", action: "label" }]);
		const strict = await run(labelling, { "a@1": "fails", "c@1": "passes" });
		expect(strict.steps.find((step) => step.nodeId === "g")?.status).toBe(
			"fail",
		);
		expect(strict.actions).toEqual([]);
	});

	test("a certainly unreached input counts as not passing on a Doesn't pass edge too", async () => {
		const definition: WorkflowDefinition = {
			...chained("any-of", [{ id: "block", action: "block" }]),
			edges: [
				{ id: "e1", from: "t", to: "a" },
				{ id: "e2", from: "a", to: "b" },
				{ id: "e3", from: "t", to: "c" },
				{ id: "e4", from: "b", to: "g", when: "fail" },
				{ id: "e5", from: "c", to: "g", when: "fail" },
				{ id: "out", from: "g", to: "block" },
			],
		};
		const result = await run(definition, { "a@1": "fails", "c@1": "passes" });
		expect(result.steps.find((step) => step.nodeId === "g")?.status).toBe(
			"fail",
		);
		expect(result.verdict).toBe("pass");
	});

	test("a gate whose inputs were all certainly unreached stays unreached", async () => {
		const definition: WorkflowDefinition = {
			id: "dormant",
			name: "dormant",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "a", type: "rule", ref: "a@1", config: {} },
				{ id: "b", type: "rule", ref: "b@1", config: {} },
				{ id: "not", type: "gate", mode: "not" },
				{ id: "block", type: "action", action: "block" },
			],
			edges: [
				{ id: "e1", from: "t", to: "a" },
				{ id: "e2", from: "a", to: "b", when: "fail" },
				{ id: "e3", from: "b", to: "not" },
				{ id: "e4", from: "not", to: "block" },
			],
		};
		const result = await run(definition, { "a@1": "passes" });
		expect(result.steps.map((step) => step.nodeId)).toEqual(["t", "a"]);
		expect(result.verdict).toBe("pass");
	});
});

describe("a rule evaluator that throws", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	test("fails the run instead of inventing a verdict", async () => {
		const run = executeWorkflow({
			definition: gateGraph("any-of", [{ state: "passes", port: "pass" }]),
			event,
			evaluateRuleRef: () => Promise.reject(new Error("boom")),
			now: () => "2026-10-23T00:00:00.000Z",
		});
		await expect(run).rejects.toThrow("boom");
	});
});
