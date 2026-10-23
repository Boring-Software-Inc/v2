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
 * The oracle, written apart from the executor: a rule that cannot evaluate
 * counts as passing, then the edge's port applies, then the gate folds.
 */
function expectedInput(state: InputState, port: InputPort): boolean {
	const passed = state !== "fails";
	return port === "pass" ? passed : !passed;
}

function expectedGate(mode: GateMode, inputs: boolean[]): "pass" | "fail" {
	if (mode === "all-of") {
		return inputs.every(Boolean) ? "pass" : "fail";
	}
	if (mode === "any-of") {
		return inputs.some(Boolean) ? "pass" : "fail";
	}
	return inputs[0] ? "fail" : "pass";
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
					const want = expectedGate(
						mode,
						wires.map((wire) => expectedInput(wire.state, wire.port)),
					);
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
			const want = expectedGate(
				"not",
				wires.map((wire) => expectedInput(wire.state, wire.port)),
			);
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

describe("unreached inputs", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	const definition: WorkflowDefinition = {
		id: "partial",
		name: "partial",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "a", type: "rule", ref: "a@1", config: {} },
			{ id: "b", type: "rule", ref: "b@1", config: {} },
			{ id: "g", type: "gate", mode: "all-of" },
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "a" },
			{ id: "e2", from: "a", to: "b", when: "fail" },
			{ id: "e3", from: "a", to: "g" },
			{ id: "e4", from: "b", to: "g" },
			{ id: "e5", from: "g", to: "block", when: "fail" },
		],
	};

	test("a gate folds only the inputs that ran", async () => {
		const result = await executeWorkflow({
			definition,
			event,
			evaluateRuleRef: (ref) => Promise.resolve(resultFor(ref, "passes")),
			now: () => "2026-10-23T00:00:00.000Z",
		});
		const gate = result.steps.find((step) => step.nodeId === "g");
		expect(gate?.input).toEqual({
			mode: "all-of",
			inputs: [
				{ from: "a", port: "pass", outcome: "pass" },
				{ from: "b", port: "pass", outcome: null },
			],
		});
		expect(gate?.status).toBe("pass");
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
