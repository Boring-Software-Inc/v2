import type { JsonValue, WorkflowDefinition } from "@tripwire/contracts";

export function skipWhenDraft(input: {
	id: string;
	name: string;
	ref: string;
	config: JsonValue;
}): WorkflowDefinition {
	return {
		id: input.id,
		name: input.name,
		version: 1,
		nodes: [
			{
				id: "trigger",
				type: "trigger",
				kinds: ["change-request.opened", "change-request.updated"],
			},
			{ id: "requirement", type: "rule", ref: input.ref, config: input.config },
			{ id: "except-when", type: "gate", mode: "unless" },
			{ id: "exception", type: "gate", mode: "all-of" },
			{
				id: "outcome",
				type: "action",
				action: "request-fix",
				params: { message: "Change the target to main." },
			},
		],
		edges: [
			{ id: "trigger-requirement", from: "trigger", to: "requirement" },
			{
				id: "requirement-gate",
				from: "requirement",
				to: "except-when",
				input: "requirement",
			},
			{
				id: "exception-gate",
				from: "exception",
				to: "except-when",
				input: "exception",
			},
			{ id: "gate-outcome", from: "except-when", to: "outcome", when: "fail" },
		],
	};
}
