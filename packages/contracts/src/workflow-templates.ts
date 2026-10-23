import type { WorkflowDefinition } from "./workflow.ts";
import { workflowAuthoring } from "./workflow-authoring-catalog.ts";
import { compileWorkflows } from "./workflow-compile.ts";

const {
	block,
	check,
	close,
	label,
	lock,
	postComment,
	removeLabel,
	schedule,
	trigger,
	workflow,
	workflows,
} = workflowAuthoring;

function staleSteps(input: {
	subject: "issue" | "change-request";
	every: { n: number; unit: "hours" | "days" };
	warnAfterDays: number;
	closeAfterDays: number;
	warning: string;
	closing: string;
	resetOn: ("change-request.updated" | "comment.created")[];
}) {
	const warn = schedule({
		every: input.every,
		match: {
			subjects: [input.subject],
			state: "open",
			inactiveFor: { n: input.warnAfterDays, unit: "days" },
			excludeLabels: ["stale", "no-auto-close"],
			skipLocked: true,
		},
	});
	const closeStale = schedule({
		every: input.every,
		match: {
			subjects: [input.subject],
			state: "open",
			inactiveFor: { n: input.closeAfterDays, unit: "days" },
			labels: ["stale"],
			excludeLabels: ["no-auto-close"],
			skipLocked: true,
		},
	});
	const reset = trigger(...input.resetOn);
	return {
		warn,
		"mark-stale": label({ labels: ["stale"] }).after(warn),
		"warn-comment": postComment({ message: input.warning }).after(warn),
		close: closeStale,
		"close-comment": postComment({ message: input.closing }).after(closeStale),
		"close-it": close().after(closeStale),
		reset,
		"unmark-stale": removeLabel({ labels: ["stale"] }).after(reset),
	};
}

const lockTrigger = schedule({
	every: { n: 12, unit: "hours" },
	match: {
		subjects: ["issue", "change-request"],
		state: "closed",
		inactiveFor: { n: 15, unit: "days" },
		skipLocked: true,
	},
});

/**
 * Templates are written as `tripwire.ts` code and compiled, so a template is
 * exactly what an agent or a person would write by hand.
 */
export const TEMPLATE_WORKFLOWS = workflows({
	"block-new-accounts": workflow({
		name: "Block new accounts",
		on: "change-request.opened",
		check: check("account-age", { minDays: 7 }),
		fail: [block()],
	}),
	"lock-inactive-threads": workflow({
		name: "Lock inactive threads",
		steps: {
			trigger: lockTrigger,
			lock: lock({ reason: "resolved" }).after(lockTrigger),
		},
	}),
	"close-stale-issues": workflow({
		name: "Close stale issues",
		steps: staleSteps({
			subject: "issue",
			every: { n: 12, unit: "hours" },
			warnAfterDays: 15,
			closeAfterDays: 7,
			warning:
				"This issue has had no activity for 15 days. It will close in 7 days unless someone comments.",
			closing:
				"Closing after 22 days with no activity. Reopen it if it still matters.",
			resetOn: ["comment.created"],
		}),
	}),
	"close-stale-change-requests": workflow({
		name: "Close stale change requests",
		steps: staleSteps({
			subject: "change-request",
			every: { n: 1, unit: "days" },
			warnAfterDays: 21,
			closeAfterDays: 7,
			warning:
				"This change request has had no activity for 3 weeks. It will close in 7 days unless someone updates it.",
			closing:
				"Closing after 4 weeks with no activity. Reopen it when you pick it back up.",
			resetOn: ["change-request.updated", "comment.created"],
		}),
	}),
});

const TEMPLATE_COPY = {
	"block-new-accounts":
		"Blocks change requests from accounts less than a week old.",
	"lock-inactive-threads":
		"Every 12 hours, locks closed issues and change requests with no activity for 15 days.",
	"close-stale-issues":
		"Every 12 hours, warns on issues with no activity for 15 days and closes them 7 days later. A comment clears the warning.",
	"close-stale-change-requests":
		"Warns after 3 weeks with no activity, closes a week later, and clears the warning on any update.",
} as const satisfies Record<keyof typeof TEMPLATE_WORKFLOWS, string>;

export interface WorkflowTemplate {
	id: string;
	name: string;
	description: string;
	definition: WorkflowDefinition;
}

const COPY_BY_ID = new Map(Object.entries(TEMPLATE_COPY));

function compileTemplates(): WorkflowTemplate[] {
	const compiled = compileWorkflows(TEMPLATE_WORKFLOWS);
	if (!compiled.ok) {
		throw new Error(
			`workflow templates do not compile: ${compiled.issues.map((issue) => issue.message).join("; ")}`,
		);
	}
	return compiled.definitions.map((definition) => ({
		id: definition.id,
		name: definition.name,
		description: COPY_BY_ID.get(definition.id) ?? "",
		definition,
	}));
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] =
	compileTemplates();
