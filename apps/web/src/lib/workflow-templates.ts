import type { WorkflowDefinition } from "@tripwire/contracts";

/**
 * Template registry (§templates) — DATA, not code branches: adding a template
 * is appending an entry. Instantiating one creates a NORMAL (disabled)
 * workflow pre-populated with these nodes; the create fn stamps fresh ids.
 * Node ids here only need to be unique within the template.
 */
export interface WorkflowTemplate {
	id: string;
	name: string;
	description: string;
	definition: Omit<WorkflowDefinition, "id" | "name">;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
	{
		id: "block-new-accounts",
		name: "Block new accounts",
		description: "Blocks change requests from accounts less than a week old.",
		definition: {
			version: 1,
			nodes: [
				{
					id: "trigger",
					type: "trigger",
					kinds: ["change-request.opened"],
					position: { x: 80, y: 160 },
				},
				{
					id: "account-age",
					type: "rule",
					ref: "account-age@1",
					config: { minDays: 7 },
					position: { x: 360, y: 160 },
				},
				{
					id: "block",
					type: "action",
					action: "block",
					position: { x: 640, y: 160 },
				},
			],
			edges: [
				{ id: "e1", from: "trigger", to: "account-age" },
				{ id: "e2", from: "account-age", to: "block", when: "fail" },
			],
		},
	},
	{
		id: "lock-inactive-threads",
		name: "Lock inactive threads",
		description:
			"Every 12 hours, locks closed issues and change requests inactive for 15 days.",
		definition: {
			version: 1,
			nodes: [
				{
					id: "trigger",
					type: "trigger",
					kinds: ["schedule.matched"],
					schedule: {
						every: "12h",
						match: {
							subjects: ["issue", "change-request"],
							state: "closed",
							inactiveDays: 15,
							skipLocked: true,
						},
					},
					position: { x: 80, y: 160 },
				},
				{
					id: "lock",
					type: "action",
					action: "lock",
					params: { reason: "resolved" },
					position: { x: 360, y: 160 },
				},
			],
			edges: [{ id: "e1", from: "trigger", to: "lock" }],
		},
	},
];
