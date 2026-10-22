import { describe, expect, test } from "bun:test";
import type {
	NormalizedEvent,
	RuleResult,
	WorkflowDefinition,
} from "@tripwire/contracts";
import { executeWorkflow } from "./executor.ts";

const SCHEDULE = {
	every: { n: 12, unit: "hours" as const },
	match: {
		subjects: ["issue" as const, "change-request" as const],
		state: "any" as const,
		inactiveFor: { n: 15, unit: "days" as const },
		skipLocked: true,
	},
};

const LOCKER: WorkflowDefinition = {
	id: "wf-lock",
	name: "lock inactive",
	version: 1,
	nodes: [
		{
			id: "stale",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: SCHEDULE,
		},
		{
			id: "weekly",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: { ...SCHEDULE, every: { n: 1, unit: "weeks" } },
		},
		{
			id: "lock",
			type: "action",
			action: "lock",
			params: { reason: "resolved" },
		},
		{ id: "close", type: "action", action: "close" },
	],
	edges: [
		{ id: "e1", from: "stale", to: "lock" },
		{ id: "e2", from: "weekly", to: "close" },
	],
};

function scheduledEvent(nodeId: string): NormalizedEvent {
	return {
		id: "ev",
		forge: "github",
		deliveryId: `schedule:wf-lock:${nodeId}:7:tick`,
		repo: {
			owner: "Codertocat",
			name: "Hello-World",
			fullName: "Codertocat/Hello-World",
		},
		actor: { login: "Codertocat", externalId: "21031067" },
		occurredAt: "2026-10-01T00:00:00.000Z",
		receivedAt: "2026-10-01T00:00:00.000Z",
		kind: "schedule.matched",
		schedule: { workflowId: "wf-lock", nodeId, tickId: "tick" },
		thread: {
			kind: "issue",
			number: 7,
			title: "Spelling error in the README file",
			url: "https://github.com/Codertocat/Hello-World/issues/7",
			state: "closed",
			author: "Codertocat",
			labels: [],
			locked: false,
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
	};
}

const neverCalled = (): Promise<RuleResult> => {
	throw new Error("no rules here");
};

let tick = 0;
const clock = () => new Date(1_760_000_000_000 + tick++ * 10).toISOString();

describe("schedule triggers", () => {
	test("only the trigger named by the event conducts", async () => {
		const result = await executeWorkflow({
			definition: LOCKER,
			event: scheduledEvent("stale"),
			evaluateRuleRef: neverCalled,
			now: clock,
		});
		expect(result.actions).toEqual([
			{ nodeId: "lock", action: "lock", params: { reason: "resolved" } },
		]);
		expect(result.steps.map((step) => step.nodeId)).toEqual(["stale", "lock"]);
		expect(result.verdict).toBe("pass");
	});

	test("the other schedule trigger collects close", async () => {
		const result = await executeWorkflow({
			definition: LOCKER,
			event: scheduledEvent("weekly"),
			evaluateRuleRef: neverCalled,
			now: clock,
		});
		expect(result.actions).toEqual([
			{ nodeId: "close", action: "close", params: {} },
		]);
	});

	test("a node id from another workflow matches nothing", async () => {
		const result = await executeWorkflow({
			definition: LOCKER,
			event: scheduledEvent("elsewhere"),
			evaluateRuleRef: neverCalled,
			now: clock,
		});
		expect(result.actions).toEqual([]);
		expect(result.steps).toEqual([]);
	});

	test("lock and close conduct from event triggers too", async () => {
		const definition: WorkflowDefinition = {
			id: "wf-events",
			name: "events",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.closed"] },
				{ id: "lock", type: "action", action: "lock" },
			],
			edges: [{ id: "e1", from: "t", to: "lock" }],
		};
		const event = scheduledEvent("stale");
		const result = await executeWorkflow({
			definition,
			event: {
				...event,
				kind: "change-request.closed",
				changeRequest: {
					number: 7,
					title: "t",
					headSha: "a".repeat(40),
					url: "https://github.com/Codertocat/Hello-World/pull/7",
				},
			} as NormalizedEvent,
			evaluateRuleRef: neverCalled,
			now: clock,
		});
		expect(result.actions.map((action) => action.action)).toEqual(["lock"]);
	});
});
