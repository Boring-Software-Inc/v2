import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import {
	canAccept,
	canDecide,
	type PushReviewSource,
	pushReviewState,
	pushReviewWorkflow,
} from "#/lib/workflow-push-review";

function gate(minDays: number): WorkflowDefinition {
	return {
		id: "gate",
		name: "Gate",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{
				id: "age",
				type: "rule",
				ref: "account-age@1",
				config: { minDays },
			},
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "age" },
			{ id: "e2", from: "age", to: "block", when: "fail" },
		],
	};
}

function source(over: Partial<PushReviewSource> = {}): PushReviewSource {
	return {
		id: "gate",
		name: "Gate",
		change: "changed",
		enabled: false,
		stale: false,
		before: gate(7),
		after: gate(30),
		issues: [],
		blocking: [],
		...over,
	};
}

describe("pushReviewWorkflow", () => {
	test("both sides are the code pull writes", () => {
		const view = pushReviewWorkflow(source());
		if (view.code.kind !== "code") {
			throw new Error("expected code");
		}
		expect(view.code.before).toContain("minDays: 7");
		expect(view.code.after).toContain("minDays: 30");
		expect(view.code.before).not.toBe(view.code.after);
	});

	test("the key is the saved name as a slug, so a rename changes only the name line", () => {
		const view = pushReviewWorkflow(
			source({
				before: { ...gate(7), id: "01a16cb7-uuid", name: "Block crypto" },
				after: { ...gate(7), id: "01a16cb7-uuid", name: "Block coins" },
			}),
		);
		if (view.code.kind !== "code") {
			throw new Error("expected code");
		}
		expect(view.code.before).toContain('"block-crypto": blockCrypto(),');
		expect(view.code.after).toContain('"block-crypto": blockCoins(),');
		expect(view.code.after).not.toContain("01a16cb7-uuid");
	});

	test("a new workflow diffs against nothing", () => {
		const view = pushReviewWorkflow(source({ change: "new", before: null }));
		expect(view.code).toMatchObject({ kind: "code", before: "" });
	});

	test("errors and warnings split, and a blocking error shows once", () => {
		const view = pushReviewWorkflow(
			source({
				issues: [
					{ severity: "error", step: "Any of", message: "It takes no inputs" },
					{ severity: "error", step: "Block", message: "Nothing runs it." },
					{
						severity: "warning",
						step: "Request GitHub review",
						message: "octocat left the repo.",
					},
				],
				blocking: ["Any of: It takes no inputs."],
			}),
		);
		expect(view.blocking).toEqual(["Any of: It takes no inputs."]);
		expect(view.errors).toEqual(["Block: Nothing runs it."]);
		expect(view.warnings).toEqual([
			"Request GitHub review: octocat left the repo.",
		]);
	});
});

describe("pushReviewState", () => {
	test("a pending push is open, or blocked by its errors", () => {
		expect(pushReviewState("pending", false)).toBe("open");
		expect(pushReviewState("pending", true)).toBe("blocked");
	});

	test("a closed push keeps its status, blocked or not", () => {
		for (const status of [
			"accepted",
			"rejected",
			"expired",
			"stale",
		] as const) {
			expect(pushReviewState(status, true)).toBe(status);
		}
	});

	test("only an open push can be accepted; a blocked one can still be declined", () => {
		expect(canAccept("open")).toBe(true);
		expect(canAccept("blocked")).toBe(false);
		expect(canDecide("blocked")).toBe(true);
		for (const state of ["accepted", "rejected", "expired", "stale"] as const) {
			expect(canDecide(state)).toBe(false);
		}
	});
});
