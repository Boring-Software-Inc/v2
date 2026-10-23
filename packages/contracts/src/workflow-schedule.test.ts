import { describe, expect, test } from "bun:test";
import { normalizedEventSchema } from "./events.ts";
import {
	completeSchedule,
	DEFAULT_WORKFLOW,
	durationMs,
	inactiveForSchema,
	labelParamsSchema,
	lockParamsSchema,
	missingScheduleSteps,
	NEW_SCHEDULE_DRAFT,
	postCommentParamsSchema,
	scheduleEverySchema,
	type TriggerNode,
	triggerNodeSchema,
	triggerScheduleSchema,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
	workflowDefinitionSchema,
} from "./workflow.ts";
import { type LintRuleId, lintWorkflow } from "./workflow-lint.ts";

const SCHEDULE: TriggerNode = {
	id: "t",
	type: "trigger",
	kinds: ["schedule.matched"],
	schedule: {
		every: { n: 12, unit: "hours" },
		match: {
			subjects: ["issue", "change-request"],
			state: "any",
			inactiveFor: { n: 15, unit: "days" },
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

	test("a complete schedule parses and skipLocked defaults to true", () => {
		const schedule = triggerScheduleSchema.parse({
			every: { n: 2, unit: "weeks" },
			match: {
				subjects: ["issue"],
				state: "closed",
				inactiveFor: { n: 3, unit: "months" },
			},
		});
		expect(schedule.match.skipLocked).toBe(true);
		expect(schedule.every).toEqual({ n: 2, unit: "weeks" });
		expect(durationMs(schedule.match.inactiveFor)).toBe(90 * 24 * 60 * 60_000);
	});

	test("a draft trigger with missing steps still parses", () => {
		const node = triggerNodeSchema.parse({
			id: "t",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: NEW_SCHEDULE_DRAFT,
		});
		expect(missingScheduleSteps(node.schedule)).toEqual([
			"every",
			"subjects",
			"state",
			"inactiveFor",
		]);
		expect(completeSchedule(node.schedule)).toBeNull();
		expect(
			missingScheduleSteps({
				every: { n: 1, unit: "hours" },
				match: { subjects: [], state: "open" },
			}),
		).toEqual(["subjects", "inactiveFor"]);
	});

	test("durations reject zero, fractions, units and huge values", () => {
		const bad = [
			{ n: 0, unit: "hours" },
			{ n: 1.5, unit: "days" },
			{ n: 1, unit: "minutes" },
			{ n: 53, unit: "weeks" },
			{ n: 366, unit: "days" },
		];
		for (const every of bad) {
			expect(scheduleEverySchema.safeParse(every).success).toBe(false);
		}
		expect(
			scheduleEverySchema.safeParse({ n: 52, unit: "weeks" }).success,
		).toBe(true);
		expect(
			scheduleEverySchema.safeParse({ n: 1, unit: "months" }).success,
		).toBe(false);
		expect(
			inactiveForSchema.safeParse({ n: 122, unit: "months" }).success,
		).toBe(false);
		expect(
			inactiveForSchema.safeParse({ n: 121, unit: "months" }).success,
		).toBe(true);
	});

	test("a complete schedule rejects bad matches", () => {
		const every = { n: 1, unit: "hours" };
		const inactiveFor = { n: 1, unit: "days" };
		const bad = [
			{ every, match: { subjects: [], state: "open", inactiveFor } },
			{ every, match: { subjects: ["issue"], state: "merged", inactiveFor } },
			{ every, match: { subjects: ["issue"], state: "open" } },
		];
		for (const schedule of bad) {
			expect(triggerScheduleSchema.safeParse(schedule).success).toBe(false);
		}
	});

	test("remove-label and comment params", () => {
		expect(labelParamsSchema.safeParse({ labels: ["stale"] }).success).toBe(
			true,
		);
		expect(labelParamsSchema.safeParse({ labels: [] }).success).toBe(false);
		expect(
			postCommentParamsSchema.safeParse({ message: "Closing this." }).success,
		).toBe(true);
		expect(postCommentParamsSchema.safeParse({ message: "  " }).success).toBe(
			false,
		);
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

	test("a half filled schedule names what is missing", () => {
		const partial: TriggerNode = {
			...SCHEDULE,
			schedule: {
				every: { n: 1, unit: "days" },
				match: { subjects: ["issue"] },
			},
		};
		const found = only(
			graph([partial, LOCK], SCHEDULED.edges),
			"schedule-config",
		);
		expect(found[0]).toMatchObject({
			step: "Trigger",
			message: "Set a status and how long without activity.",
		});
		expect(found[0]?.fixes[0]).toMatchObject({
			intent: { type: "focus-field", nodeId: "t", field: "state" },
		});
	});

	test("remove-label needs labels and comment needs a message", () => {
		const def = graph(
			[
				SCHEDULE,
				{
					id: "rm",
					type: "action",
					action: "remove-label",
					params: { labels: [] },
				},
				{ id: "say", type: "action", action: "post-comment" },
			],
			[
				{ id: "e1", from: "t", to: "rm" },
				{ id: "e2", from: "t", to: "say" },
			],
		);
		const found = only(def, "action-params");
		expect(
			found.map((result) => [result.nodeId, result.step, result.message]),
		).toEqual([
			["rm", "Remove label", "Pick the labels to remove."],
			["say", "Comment", "Write the message."],
		]);
	});

	test("one workflow can hold two schedules and an event trigger", () => {
		const warn: TriggerNode = { ...SCHEDULE, id: "warn" };
		const close: TriggerNode = { ...SCHEDULE, id: "close" };
		const reset: TriggerNode = {
			id: "reset",
			type: "trigger",
			kinds: ["change-request.updated", "comment.created"],
		};
		const def = graph(
			[
				warn,
				close,
				reset,
				{
					id: "mark",
					type: "action",
					action: "label",
					params: { labels: ["stale"] },
				},
				{
					id: "warned",
					type: "action",
					action: "post-comment",
					params: { message: "This will close in 7 days." },
				},
				{ id: "shut", type: "action", action: "close" },
				{
					id: "unmark",
					type: "action",
					action: "remove-label",
					params: { labels: ["stale"] },
				},
			],
			[
				{ id: "e1", from: "warn", to: "mark" },
				{ id: "e2", from: "warn", to: "warned" },
				{ id: "e3", from: "close", to: "shut" },
				{ id: "e4", from: "reset", to: "unmark" },
			],
		);
		expect(lintWorkflow(def)).toEqual([]);
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
