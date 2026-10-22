import { describe, expect, test } from "bun:test";
import { normalizedEventSchema } from "./events.ts";
import {
	DEFAULT_WORKFLOW,
	lockParamsSchema,
	triggerNodeSchema,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
	workflowDefinitionSchema,
} from "./workflow.ts";
import { type LintRuleId, lintWorkflow } from "./workflow-lint.ts";

const SCHEDULE: WorkflowNode = {
	id: "t",
	type: "trigger",
	kinds: ["schedule.matched"],
	schedule: {
		every: "12h",
		match: {
			subjects: ["issue", "change-request"],
			state: "any",
			inactiveDays: 15,
			skipLocked: true,
		},
	},
	position: { x: 0, y: 0 },
};
const EVENT_TRIGGER: WorkflowNode = {
	id: "t",
	type: "trigger",
	kinds: ["change-request.opened"],
	position: { x: 0, y: 0 },
};
const LOCK: WorkflowNode = {
	id: "l",
	type: "action",
	action: "lock",
	params: { reason: "resolved" },
	position: { x: 300, y: 0 },
};
const CLOSE: WorkflowNode = {
	id: "c",
	type: "action",
	action: "close",
	position: { x: 300, y: 200 },
};
const RULE: WorkflowNode = {
	id: "r",
	type: "rule",
	ref: "account-age@1",
	config: { minDays: 7 },
	position: { x: 300, y: 0 },
};

function graph(
	nodes: WorkflowNode[],
	edges: WorkflowEdge[],
): WorkflowDefinition {
	return { id: "w", name: "w", version: 1, nodes, edges };
}

function only(def: WorkflowDefinition, rule: LintRuleId) {
	return lintWorkflow(def).filter((result) => result.rule === rule);
}

const SCHEDULED = graph([SCHEDULE, LOCK], [{ id: "e1", from: "t", to: "l" }]);

describe("schedule trigger schema", () => {
	test("stored definitions without a schedule still parse", () => {
		const parsed = workflowDefinitionSchema.parse(DEFAULT_WORKFLOW);
		const trigger = parsed.nodes.find((node) => node.type === "trigger");
		expect(trigger?.type === "trigger" && trigger.schedule).toBeUndefined();
	});

	test("schedule config parses and skipLocked defaults to true", () => {
		const node = triggerNodeSchema.parse({
			id: "t",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: {
				every: "12h",
				match: { subjects: ["issue"], state: "closed", inactiveDays: 15 },
			},
		});
		expect(node.schedule?.match.skipLocked).toBe(true);
	});

	test("schedule config rejects bad values", () => {
		const bad = [
			{ every: "5m", match: { subjects: ["issue"], state: "open" } },
			{ every: "1h", match: { subjects: [], state: "open" } },
			{ every: "1h", match: { subjects: ["issue"], state: "merged" } },
			{
				every: "1h",
				match: { subjects: ["issue"], state: "open", inactiveDays: 0 },
			},
			{
				every: "1h",
				match: { subjects: ["issue"], state: "open", inactiveDays: 3651 },
			},
		];
		for (const schedule of bad) {
			expect(
				triggerNodeSchema.safeParse({
					id: "t",
					type: "trigger",
					kinds: ["schedule.matched"],
					schedule,
				}).success,
			).toBe(false);
		}
	});

	test("lock params accept GitHub lock reasons only", () => {
		expect(lockParamsSchema.safeParse({ reason: "too heated" }).success).toBe(
			true,
		);
		expect(lockParamsSchema.safeParse({}).success).toBe(true);
		expect(lockParamsSchema.safeParse({ reason: "boring" }).success).toBe(
			false,
		);
	});

	test("a scheduled event parses", () => {
		const event = normalizedEventSchema.parse({
			id: "e1",
			forge: "github",
			deliveryId: "schedule:w:t:12:tick",
			repo: { owner: "acme", name: "widgets", fullName: "acme/widgets" },
			actor: { login: "octocat", externalId: "583231" },
			occurredAt: "2026-10-01T00:00:00.000Z",
			receivedAt: "2026-10-01T00:00:00.000Z",
			kind: "schedule.matched",
			schedule: { workflowId: "w", nodeId: "t", tickId: "tick" },
			thread: {
				kind: "issue",
				number: 12,
				title: "Crash on start",
				url: "https://github.com/acme/widgets/issues/12",
				state: "closed",
				author: "octocat",
				labels: ["bug"],
				locked: false,
				updatedAt: "2026-09-01T00:00:00.000Z",
			},
		});
		expect(event.kind).toBe("schedule.matched");
	});
});

describe("schedule lint rules", () => {
	test("a schedule trigger feeding lock lints clean", () => {
		expect(lintWorkflow(SCHEDULED)).toEqual([]);
	});

	test("a schedule trigger without a schedule is an error", () => {
		const bare: WorkflowNode = {
			id: "t",
			type: "trigger",
			kinds: ["schedule.matched"],
		};
		const found = only(graph([bare, LOCK], SCHEDULED.edges), "schedule-config");
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ nodeId: "t", severity: "error" });
	});

	test("a schedule trigger cannot mix in other events", () => {
		const mixed = graph(
			[{ ...SCHEDULE, kinds: ["schedule.matched", "push"] }, LOCK],
			SCHEDULED.edges,
		);
		expect(only(mixed, "schedule-mixed")).toHaveLength(1);
		expect(only(SCHEDULED, "schedule-mixed")).toEqual([]);
	});

	test("block and human review reached from a schedule are errors", () => {
		const def = graph(
			[
				SCHEDULE,
				RULE,
				{ id: "a", type: "action", action: "block" },
				{ id: "m", type: "action", action: "send-to-moderation" },
			],
			[
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "a", when: "fail" },
				{ id: "e3", from: "r", to: "m", when: "fail" },
			],
		);
		const found = only(def, "schedule-needs-change-request");
		expect(found.map((result) => result.nodeId).sort()).toEqual(["a", "m"]);
		expect(found[0]?.message).toContain("needs a change request event");
	});

	test("block on an event trigger is not flagged", () => {
		expect(
			only(
				graph(
					[EVENT_TRIGGER, { id: "a", type: "action", action: "block" }],
					[{ id: "e1", from: "t", to: "a" }],
				),
				"schedule-needs-change-request",
			),
		).toEqual([]);
	});

	test("lock and close are fine on event triggers", () => {
		const def = graph(
			[EVENT_TRIGGER, LOCK, CLOSE],
			[
				{ id: "e1", from: "t", to: "l" },
				{ id: "e2", from: "t", to: "c" },
			],
		);
		expect(lintWorkflow(def)).toEqual([]);
	});
});
