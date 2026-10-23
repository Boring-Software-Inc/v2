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
			"Every 12 hours, locks closed issues and change requests with no activity for 15 days.",
		definition: {
			version: 1,
			nodes: [
				{
					id: "trigger",
					type: "trigger",
					kinds: ["schedule.matched"],
					schedule: {
						every: { n: 12, unit: "hours" },
						match: {
							subjects: ["issue", "change-request"],
							state: "closed",
							inactiveFor: { n: 15, unit: "days" },
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
					position: { x: 400, y: 160 },
				},
			],
			edges: [{ id: "e1", from: "trigger", to: "lock" }],
		},
	},
	{
		id: "close-stale-change-requests",
		name: "Close stale change requests",
		description:
			"Warns after 3 weeks with no activity, closes a week later, and clears the warning on any update.",
		definition: {
			version: 1,
			nodes: [
				{
					id: "warn",
					type: "trigger",
					kinds: ["schedule.matched"],
					schedule: {
						every: { n: 1, unit: "days" },
						match: {
							subjects: ["change-request"],
							state: "open",
							inactiveFor: { n: 21, unit: "days" },
							excludeLabels: ["stale", "no-auto-close"],
							skipLocked: true,
						},
					},
					position: { x: 80, y: 40 },
				},
				{
					id: "mark-stale",
					type: "action",
					action: "label",
					params: { labels: ["stale"] },
					position: { x: 440, y: 0 },
				},
				{
					id: "warn-comment",
					type: "action",
					action: "post-comment",
					params: {
						message:
							"This change request has had no activity for 3 weeks. It will close in 7 days unless someone updates it.",
					},
					position: { x: 440, y: 140 },
				},
				{
					id: "close",
					type: "trigger",
					kinds: ["schedule.matched"],
					schedule: {
						every: { n: 1, unit: "days" },
						match: {
							subjects: ["change-request"],
							state: "open",
							inactiveFor: { n: 7, unit: "days" },
							labels: ["stale"],
							excludeLabels: ["no-auto-close"],
							skipLocked: true,
						},
					},
					position: { x: 80, y: 480 },
				},
				{
					id: "close-comment",
					type: "action",
					action: "post-comment",
					params: {
						message:
							"Closing after 4 weeks with no activity. Reopen it when you pick it back up.",
					},
					position: { x: 440, y: 420 },
				},
				{
					id: "close-it",
					type: "action",
					action: "close",
					position: { x: 440, y: 640 },
				},
				{
					id: "reset",
					type: "trigger",
					kinds: ["change-request.updated", "comment.created"],
					position: { x: 80, y: 820 },
				},
				{
					id: "unmark-stale",
					type: "action",
					action: "remove-label",
					params: { labels: ["stale"] },
					position: { x: 440, y: 820 },
				},
			],
			edges: [
				{ id: "e1", from: "warn", to: "mark-stale" },
				{ id: "e2", from: "warn", to: "warn-comment" },
				{ id: "e3", from: "close", to: "close-comment" },
				{ id: "e4", from: "close", to: "close-it" },
				{ id: "e5", from: "reset", to: "unmark-stale" },
			],
		},
	},
];
