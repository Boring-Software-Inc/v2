import { describe, expect, test } from "bun:test";
import { resolveResumeOutcome } from "./resume-run.ts";

/**
 * The moderation verdict is the maintainer's decision, NOT a function of which
 * nodes the graph walked. Regression for the prod miss (scratch #83): the
 * send-to-moderation node's deny edge was drawn to a `discord` action with no
 * block anywhere, so a denied change resumed to `pass` — a green check on an
 * explicitly denied PR. Deny must block regardless of where the edge points.
 */

describe("resolveResumeOutcome", () => {
	test("deny with a deny edge to a NON-block action still blocks (the prod bug)", () => {
		// graph walked send-to-moderation → discord, produced verdict `pass`.
		const out = resolveResumeOutcome("deny", {
			verdict: "pass",
			actions: [{ action: "discord" }],
		});
		expect(out.verdict).toBe("block");
		// the graph produced no block of its own ⇒ floor one in.
		expect(out.floorBlock).toBe(true);
	});

	test("deny with no edges / no actions still blocks and floors a block", () => {
		const out = resolveResumeOutcome("deny", { verdict: "pass", actions: [] });
		expect(out.verdict).toBe("block");
		expect(out.floorBlock).toBe(true);
	});

	test("deny whose graph already blocks does not double-floor", () => {
		const out = resolveResumeOutcome("deny", {
			verdict: "block",
			actions: [{ action: "block" }],
		});
		expect(out.verdict).toBe("block");
		expect(out.floorBlock).toBe(false);
	});

	test("approve resumes to the graph's verdict — pass stays pass", () => {
		const out = resolveResumeOutcome("approve", {
			verdict: "pass",
			actions: [{ action: "discord" }],
		});
		expect(out.verdict).toBe("pass");
		expect(out.floorBlock).toBe(false);
	});

	test("approve never floors a block, even if the graph blocked", () => {
		const out = resolveResumeOutcome("approve", {
			verdict: "block",
			actions: [{ action: "block" }],
		});
		expect(out.verdict).toBe("block");
		expect(out.floorBlock).toBe(false);
	});
});
