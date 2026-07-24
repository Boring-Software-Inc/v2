import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { customRules, repos } from "../schema/repos.ts";
import { deleteCustomRule, workflowsReferencingRule } from "./repos.ts";
import {
	createWorkflow,
	deleteWorkflow,
	listWorkflows,
	setWorkflowEnabled,
} from "./workflows.ts";

/**
 * The delete guard over REAL Postgres: a custom rule referenced by ANY workflow
 * (enabled OR disabled) cannot be deleted; the block names every workflow; once
 * the last reference is gone, deletion succeeds. The escape hatch must work — a
 * stale workflow must never permanently trap cleanup.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let repoId: string;

const RULE_ID = "custom-guard-fixture";
const REF = `${RULE_ID}@1`;

/** A valid-for-enable graph referencing the custom rule: trigger → rule → block. */
function graphWith(name: string): WorkflowDefinition {
	return {
		id: generateId(),
		name,
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: REF, config: {} },
			{ id: "a", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	};
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	repoId = generateId();
	await db.insert(repos).values({
		id: repoId,
		externalId: "guard-1",
		owner: "acme",
		name: "api",
		fullName: "acme/api",
	});
	await db.insert(customRules).values({
		id: RULE_ID,
		repoId,
		name: "guard fixture",
		enabled: true,
		definition: {
			when: { id: "contributor.accountAge" },
			comparison: { kind: "atLeast", args: [7] },
			severity: "medium",
		},
	});
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("deleteCustomRule guard", () => {
	test("a DISABLED workflow blocks deletion and is named", async () => {
		await createWorkflow(db, {
			repoId,
			name: "alpha",
			definition: graphWith("alpha"),
		});
		expect(
			(await workflowsReferencingRule(db, repoId, RULE_ID)).map((w) => w.name),
		).toContain("alpha");
		const result = await deleteCustomRule(db, repoId, RULE_ID);
		expect(result.deleted).toBe(false);
		expect(result.blockedBy.map((w) => w.name)).toContain("alpha");
	});

	test("an ENABLED workflow also blocks deletion", async () => {
		const wf = await createWorkflow(db, {
			repoId,
			name: "beta",
			definition: graphWith("beta"),
		});
		const enabled = await setWorkflowEnabled(db, {
			repoId,
			workflowId: wf.id,
			enabled: true,
		});
		expect(enabled.ok).toBe(true);
		expect((await deleteCustomRule(db, repoId, RULE_ID)).deleted).toBe(false);
	});

	test("names EVERY blocking workflow, not just the first", async () => {
		const result = await deleteCustomRule(db, repoId, RULE_ID);
		expect(result.deleted).toBe(false);
		expect(result.blockedBy.map((w) => w.name).sort()).toEqual([
			"alpha",
			"beta",
		]);
	});

	test("allowed once the LAST reference is removed", async () => {
		for (const wf of await listWorkflows(db, repoId)) {
			await deleteWorkflow(db, { repoId, workflowId: wf.id });
		}
		const result = await deleteCustomRule(db, repoId, RULE_ID);
		expect(result.deleted).toBe(true);
		expect(result.blockedBy).toEqual([]);
	});
});
