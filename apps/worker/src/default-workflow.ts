import type { WorkflowDefinition } from "@tripwire/contracts";
import { validateWorkflow } from "@tripwire/core";

/**
 * The hand-seeded default workflow (§13.6): used for any repo without its own
 * definitions. Boring thresholds; per-repo tuning happens in the Rules UI.
 * Validated at module load — a broken default is a boot failure, not a
 * runtime surprise.
 */
const DEFINITION: WorkflowDefinition = {
	id: "default@1",
	name: "default gate",
	version: 1,
	nodes: [
		{
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
		{
			id: "account-age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
		},
		{ id: "crypto", type: "rule", ref: "crypto-address@1", config: {} },
		{
			id: "honeypot",
			type: "rule",
			ref: "honeypot@1",
			config: { paths: [".github/workflows/**"] },
		},
		{
			id: "max-files",
			type: "rule",
			ref: "max-files-changed@1",
			config: { max: 200 },
		},
		{
			id: "english",
			type: "rule",
			ref: "english-only@1",
			config: { maxNonLatinRatio: 0.5 },
		},
		{
			id: "ai-review",
			type: "rule",
			ref: "ai-review@1",
			config: { model: "claude-fable-5", maxSteps: 12 },
		},
		{ id: "gate", type: "gate", mode: "all-of" },
		{ id: "block", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "trigger", to: "account-age" },
		{ id: "e2", from: "trigger", to: "crypto" },
		{ id: "e3", from: "trigger", to: "honeypot" },
		{ id: "e4", from: "trigger", to: "max-files" },
		{ id: "e5", from: "trigger", to: "english" },
		{ id: "e6", from: "account-age", to: "gate" },
		{ id: "e7", from: "crypto", to: "gate" },
		{ id: "e8", from: "honeypot", to: "gate" },
		{ id: "e9", from: "max-files", to: "gate" },
		{ id: "e10", from: "english", to: "gate" },
		{ id: "e11", from: "gate", to: "block", when: "fail" },
		{ id: "e12", from: "trigger", to: "ai-review" },
		{ id: "e13", from: "ai-review", to: "gate" },
	],
};

const validated = validateWorkflow(DEFINITION);
if (!validated.valid) {
	throw new Error(
		`default workflow invalid: ${JSON.stringify(validated.issues)}`,
	);
}

export const DEFAULT_WORKFLOW: WorkflowDefinition = validated.definition;
