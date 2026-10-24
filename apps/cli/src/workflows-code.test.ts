import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@tripwire/contracts";
import {
	initialPicks,
	mergeDefinitions,
	type PulledWorkflow,
	pulledCountText,
	selectPulled,
	workflowChoices,
} from "#/workflows-code";

describe("pull says how many workflows it wrote", () => {
	test("the count is what the file holds", () => {
		expect(pulledCountText({ count: 1, pulled: 1 })).toBe("1 workflow");
		expect(pulledCountText({ count: 5, pulled: 5 })).toBe("5 workflows");
	});

	test("a workflow left out is counted apart, never as written", () => {
		expect(pulledCountText({ count: 5, pulled: 6 })).toBe(
			"5 workflows, 1 left out",
		);
	});
});

const gate = (id: string, name: string, kinds: string[]) => ({
	id,
	name,
	version: 1,
	nodes: [
		{ id: "trigger", type: "trigger" as const, kinds },
		{ id: "block", type: "action" as const, action: "block" as const },
	],
	edges: [{ id: "e1", from: "trigger", to: "block" }],
});

const PULLED: PulledWorkflow[] = [
	{
		id: "new-accounts",
		appId: "w1",
		name: "New accounts",
		enabled: true,
		definition: workflowDefinitionSchema.parse(
			gate("new-accounts", "New accounts", ["change-request.opened"]),
		),
	},
	{
		id: "stale",
		appId: "w2",
		name: "Stale issues",
		enabled: false,
		definition: workflowDefinitionSchema.parse(
			gate("stale", "Stale issues", ["comment.created"]),
		),
	},
];

describe("picking workflows to pull", () => {
	test("each choice shows its state and triggers", () => {
		expect(
			workflowChoices(PULLED, new Map([["w1", { state: "needs-fixes" }]])),
		).toEqual([
			{
				value: "new-accounts",
				label: "New accounts",
				hint: "needs fixes, change request opened",
			},
			{ value: "stale", label: "Stale issues", hint: "off, comment created" },
		]);
	});

	test("a scheduled workflow shows its schedule in the list's words", () => {
		const sweep: PulledWorkflow = {
			id: "stale-sweep",
			appId: "w3",
			name: "Stale sweep",
			enabled: true,
			definition: workflowDefinitionSchema.parse({
				id: "stale-sweep",
				name: "Stale sweep",
				version: 1,
				nodes: [
					{
						id: "trigger",
						type: "trigger",
						kinds: ["schedule.matched"],
						schedule: {
							every: { cron: "*/15 * * * *" },
							timezone: "Europe/Berlin",
							match: {
								subjects: ["issue"],
								state: "open",
								inactiveFor: { n: 30, unit: "days" },
							},
						},
					},
					{ id: "close", type: "action", action: "close" },
				],
				edges: [{ id: "e1", from: "trigger", to: "close" }],
			}),
		};
		expect(
			workflowChoices(
				[sweep],
				new Map([
					["w3", { state: "on", schedules: ["every 15 minutes in Berlin"] }],
				]),
			),
		).toEqual([
			{
				value: "stale-sweep",
				label: "Stale sweep",
				hint: "live, every 15 minutes in Berlin",
			},
		]);
	});

	test("a workflow that cannot be written as code is shown but not pickable", () => {
		const broken = workflowDefinitionSchema.parse({
			id: "broken",
			name: "Broken",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "g", type: "gate", mode: "all-of" },
				{ id: "b", type: "action", action: "block" },
			],
			edges: [
				{ id: "e1", from: "t", to: "g" },
				{ id: "e2", from: "g", to: "b", when: "fail" },
			],
		});
		const [choice] = workflowChoices(
			[{ id: "broken", name: "Broken", enabled: false, definition: broken }],
			new Map(),
		);
		expect(choice?.disabled).toStartWith("cannot be written as code");
	});

	test("the local file's workflows start picked, or every workflow without one", () => {
		const choices = workflowChoices(PULLED, new Map());
		expect(initialPicks(choices, null)).toEqual(["new-accounts", "stale"]);
		expect(initialPicks(choices, ["stale", "gone"])).toEqual(["stale"]);
	});

	test("workflow args match by id, app id or name, and name the unknown ones", () => {
		expect(selectPulled(PULLED, ["w2", "New accounts", "nope"])).toEqual({
			picked: PULLED,
			unknown: ["nope"],
		});
	});

	test("a pulled subset replaces its own workflows and keeps the rest", () => {
		const local = [
			workflowDefinitionSchema.parse(
				gate("local", "Local", ["comment.created"]),
			),
			workflowDefinitionSchema.parse(
				gate("stale", "Old stale", ["comment.created"]),
			),
		];
		const merged = mergeDefinitions(local, [
			PULLED[1]?.definition ?? never(),
			PULLED[0]?.definition ?? never(),
		]);
		expect(merged.definitions.map((definition) => definition.name)).toEqual([
			"Local",
			"Stale issues",
			"New accounts",
		]);
		expect(merged.kept).toEqual(["Local"]);
	});
});

function never(): never {
	throw new Error("missing fixture");
}
