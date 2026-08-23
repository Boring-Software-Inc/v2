import { describe, expect, test } from "bun:test";
import type { RunView } from "#/lib/runs.functions";
import {
	collapseSurfaceActions,
	collapseTriggerSteps,
} from "#/lib/server/run-view";

/**
 * Render-time dedupe of a JOINED run (§5.11): the persisted rows stay 1:1 with
 * execution (stats/replay/delivery read those), the feed reads clean. The load-
 * bearing invariant: NEVER collapse a distinct delivery. Two discord sends to
 * two urls are two rows, not a dupe — and the url is §10-stripped from this
 * view, so a delivery kind is never merged.
 */

// The helpers read only nodeKind / kind; minimal objects suffice.
const steps = (kinds: string[]): RunView["steps"] =>
	kinds.map((nodeKind, i) => ({ id: String(i), nodeKind })) as RunView["steps"];
const actions = (kinds: string[]): RunView["actions"] =>
	kinds.map((kind) => ({ kind })) as RunView["actions"];

describe("collapseTriggerSteps", () => {
	test("N triggers collapse to one; every rule/gate/action step stays", () => {
		const out = collapseTriggerSteps(
			steps(["trigger", "rule", "trigger", "gate", "trigger", "action"]),
		);
		expect(out.filter((s) => s.nodeKind === "trigger")).toHaveLength(1);
		expect(out.map((s) => s.nodeKind)).toEqual([
			"trigger",
			"rule",
			"gate",
			"action",
		]);
	});
});

describe("collapseSurfaceActions", () => {
	test("duplicate block / comment / set-check collapse to one each", () => {
		const out = collapseSurfaceActions(
			actions(["set-check", "comment", "set-check", "block", "block"]),
		);
		expect(out.map((a) => a.kind)).toEqual(["set-check", "comment", "block"]);
	});

	test("NEVER collapses delivery or label actions (targets the view can't see)", () => {
		const out = collapseSurfaceActions(
			actions(["discord", "discord", "label", "label", "webhook"]),
		);
		expect(out.map((a) => a.kind)).toEqual([
			"discord",
			"discord",
			"label",
			"label",
			"webhook",
		]);
	});

	test("a joined run: one block, one set-check, but TWO discord", () => {
		const out = collapseSurfaceActions(
			actions([
				"set-check",
				"discord",
				"set-check",
				"discord",
				"block",
				"block",
			]),
		);
		expect(out.filter((a) => a.kind === "set-check")).toHaveLength(1);
		expect(out.filter((a) => a.kind === "block")).toHaveLength(1);
		expect(out.filter((a) => a.kind === "discord")).toHaveLength(2);
	});
});
