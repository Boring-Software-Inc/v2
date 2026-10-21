import type { WorkflowDefinition, WorkflowNode } from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	RULE_CATALOG,
	TRIGGER_CATALOG,
} from "@tripwire/contracts";
import { createDb, repoServices, workflowServices } from "@tripwire/db";
import { generateId } from "@tripwire/utils";

/**
 * Seed a full CATALOG of workflows onto a repo — one per rule, gate, and
 * trigger — so the grid/editor have real graphs to explore and the
 * `workflow-existing` e2e has something to chew on. Everything is created
 * DISABLED (§4: enabling is a deliberate act — seeding must never change what
 * a repo enforces). Idempotent: an existing workflow with the same name is
 * left alone.
 *
 *   bun run scripts/seed-workflows.ts <owner/repo>
 */

const repoFullName = process.argv[2];
if (!repoFullName) {
	console.error("usage: bun run scripts/seed-workflows.ts <owner/repo>");
	process.exit(2);
}

function base(
	name: string,
	kinds: ("change-request.opened" | "change-request.updated")[] | string[],
	middle: WorkflowNode[],
	edges: WorkflowDefinition["edges"],
): WorkflowDefinition {
	return {
		id: generateId(),
		name,
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: kinds as never,
				position: { x: 80, y: 160 },
			},
			...middle,
			{
				id: "block",
				type: "action",
				action: "block",
				position: { x: 640, y: 160 },
			},
		],
		edges,
	};
}

const CR = ["change-request.opened", "change-request.updated"];

const definitions: WorkflowDefinition[] = [
	// one per RULE — trigger → rule —fail→ block, catalog defaults
	...RULE_CATALOG.map((rule) =>
		base(
			`rule: ${rule.name}`,
			CR,
			[
				{
					id: "r",
					type: "rule",
					ref: `${rule.ruleId}@${rule.version}`,
					config: structuredClone(rule.defaultConfig) as never,
					position: { x: 360, y: 160 },
				},
			],
			[
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "block", when: "fail" },
			],
		),
	),
	// one per GATE — two feeds where arity allows, one for `not`
	...GATE_CATALOG.map((gate) => {
		const two = gate.mode !== "not";
		return base(
			`gate: ${gate.name}`,
			CR,
			[
				{
					id: "r1",
					type: "rule",
					ref: "crypto-address@1",
					config: {},
					position: { x: 340, y: two ? 90 : 160 },
				},
				...(two
					? ([
							{
								id: "r2",
								type: "rule",
								ref: "account-age@1",
								config: { minDays: 7 },
								position: { x: 340, y: 240 },
							},
						] as WorkflowNode[])
					: []),
				{
					id: "g",
					type: "gate",
					mode: gate.mode,
					position: { x: 500, y: 160 },
				},
			],
			[
				{ id: "e1", from: "t", to: "r1" },
				...(two
					? [
							{ id: "e2", from: "t", to: "r2" },
							{ id: "e3", from: "r2", to: "g" },
						]
					: []),
				{ id: "e4", from: "r1", to: "g" },
				{ id: "e5", from: "g", to: "block", when: "fail" as const },
			],
		);
	}),
	// one per toolbox TRIGGER — trigger(kind) → crypto —fail→ block (crypto
	// scans titles, comments, and diffs, so it's meaningful on every kind)
	...TRIGGER_CATALOG.filter((entry) => entry.toolbox).map((entry) =>
		base(
			`trigger: ${entry.name}`,
			[entry.kind],
			[
				{
					id: "r",
					type: "rule",
					ref: "crypto-address@1",
					config: {},
					position: { x: 360, y: 160 },
				},
			],
			[
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "block", when: "fail" },
			],
		),
	),
];

const { db, pool } = createDb();
const repo = await repoServices.getRepoByFullName(db, repoFullName, "github");
if (!repo) {
	console.error(`repo ${repoFullName} is not in the DB`);
	await pool.end();
	process.exit(1);
}
const existing = new Set(
	(await workflowServices.listWorkflows(db, repo.id)).map((w) => w.name),
);
let created = 0;
for (const definition of definitions) {
	if (existing.has(definition.name)) {
		continue;
	}
	await workflowServices.createWorkflow(db, {
		repoId: repo.id,
		name: definition.name,
		definition,
	});
	created++;
}
console.log(
	`seeded ${created} workflows onto ${repoFullName} (${definitions.length - created} already present) — ALL DISABLED; enable in the grid`,
);
console.log(
	`catalog: ${RULE_CATALOG.length} rules, ${GATE_CATALOG.length} gates, ${TRIGGER_CATALOG.filter((t) => t.toolbox).length} triggers · action kinds available: ${ACTION_CATALOG.length}`,
);
await pool.end();
