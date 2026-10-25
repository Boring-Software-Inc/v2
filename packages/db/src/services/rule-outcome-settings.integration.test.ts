import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import * as customRuleServices from "./custom-rules.ts";
import * as repoServices from "./repos.ts";
import * as ruleServices from "./rules.ts";
import { createWorkflow, setWorkflowEnabled } from "./workflows.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

let seq = 0;
async function repo(): Promise<string> {
	seq += 1;
	const created = await repoServices.ensureRepo(db, {
		externalId: `outcome-${seq}`,
		owner: "acme",
		name: `outcome-${seq}`,
		fullName: `acme/outcome-${seq}`,
	});
	return created;
}

async function view(repoId: string, ruleId: string) {
	const rules = await ruleServices.listRuleViews(db, repoId);
	const found = rules.find((rule) => rule.ruleId === ruleId);
	if (!found) {
		throw new Error(`no view for ${ruleId}`);
	}
	return found;
}

const AGE_GATE: WorkflowDefinition = {
	id: "age-gate",
	name: "Age gate",
	version: 1,
	nodes: [
		{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "age", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
		{ id: "block", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "trigger", to: "age" },
		{ id: "e2", from: "age", to: "block", when: "fail" },
	],
} as WorkflowDefinition;

describe("rule outcome settings", () => {
	test("a rule nobody touched reads Block with no owners", async () => {
		const repoId = await repo();
		const age = await view(repoId, "account-age");
		expect(age.outcome).toEqual({ outcome: "block", instruction: "" });
		expect(age.owners).toEqual([]);
	});

	test("setting an outcome on an unconfigured rule keeps it off", async () => {
		const repoId = await repo();
		const result = await ruleServices.setRuleOutcome(db, {
			repoId,
			ruleId: "account-age",
			outcome: "request_fix",
			instruction: "  Wait a week, then push again.  ",
		});
		expect(result).toEqual({ ok: true });
		const age = await view(repoId, "account-age");
		expect(age.enabled).toBe(false);
		expect(age.outcome).toEqual({
			outcome: "request_fix",
			instruction: "Wait a week, then push again.",
		});
	});

	test("turning a rule on and saving settings keeps its outcome", async () => {
		const repoId = await repo();
		await ruleServices.setRuleOutcome(db, {
			repoId,
			ruleId: "account-age",
			outcome: "note",
			instruction: "New account.",
		});
		await ruleServices.setRulesEnabled(db, {
			repoId,
			ruleIds: ["account-age"],
			enabled: true,
		});
		await ruleServices.saveRuleConfig(db, {
			repoId,
			ruleId: "account-age",
			enabled: true,
			config: { minDays: 14 },
		});
		const age = await view(repoId, "account-age");
		expect(age.enabled).toBe(true);
		expect(age.outcome).toEqual({
			outcome: "note",
			instruction: "New account.",
		});
	});

	test("a rule turned on from the library uses Block", async () => {
		const repoId = await repo();
		await ruleServices.setRulesEnabled(db, {
			repoId,
			ruleIds: ["crypto-address"],
			enabled: true,
		});
		expect((await view(repoId, "crypto-address")).outcome.outcome).toBe(
			"block",
		);
	});

	test("bad input is refused and saves nothing", async () => {
		const repoId = await repo();
		const bad = await ruleServices.setRuleOutcome(db, {
			repoId,
			ruleId: "account-age",
			outcome: "allow",
		});
		expect(bad).toEqual({
			error: "Pick one of block, request_fix, human_review, note, close.",
		});
		const long = await ruleServices.setRuleOutcome(db, {
			repoId,
			ruleId: "account-age",
			outcome: "request_fix",
			instruction: "x".repeat(501),
		});
		expect("error" in long && long.error).toContain("Instruction:");
		const unknown = await ruleServices.setRuleOutcome(db, {
			repoId,
			ruleId: "no-such-rule",
			outcome: "block",
		});
		expect("error" in unknown).toBe(true);
		const age = await view(repoId, "account-age");
		expect(age.outcome.outcome).toBe("block");
		expect(
			(await repoServices.listRuleConfigs(db, repoId)).some(
				(row) => row.ruleId === "account-age",
			),
		).toBe(false);
	});

	test("a workflow owns the outcome of the rules it uses", async () => {
		const repoId = await repo();
		const workflow = await createWorkflow(db, {
			repoId,
			name: "Age gate",
			definition: AGE_GATE,
		});
		const enabled = await setWorkflowEnabled(db, {
			repoId,
			workflowId: workflow.id,
			enabled: true,
		});
		expect(enabled.ok).toBe(true);
		const age = await view(repoId, "account-age");
		expect(age.management).toBe("managed");
		expect(age.owners).toEqual([{ id: workflow.id, name: "Age gate" }]);
		const refused = await ruleServices.setRuleOutcome(db, {
			repoId,
			ruleId: "account-age",
			outcome: "close",
		});
		expect(refused).toEqual({
			error: "Set in Age gate. Change the outcome in the workflow.",
		});
	});

	test("custom rules default to Block and take an outcome on save and later", async () => {
		const repoId = await repo();
		const definition = {
			when: { id: "pr.targetBranch" },
			comparison: { kind: "oneOf", args: [["main"]] },
		};
		const plain = await customRuleServices.saveCustomRule(db, {
			repoId,
			name: "Into main",
			definition,
		});
		expect(plain.ok && plain.rule.outcome).toEqual({
			outcome: "block",
			instruction: "",
		});
		const fix = await customRuleServices.saveCustomRule(db, {
			repoId,
			name: "Target main",
			definition,
			outcome: {
				outcome: "request_fix",
				instruction: "Change the target to main.",
			},
		});
		if (!fix.ok) {
			throw new Error(fix.error);
		}
		expect((await view(repoId, fix.rule.id)).outcome).toEqual({
			outcome: "request_fix",
			instruction: "Change the target to main.",
		});
		const renamed = await customRuleServices.saveCustomRule(db, {
			repoId,
			id: fix.rule.id,
			name: "Target main only",
			definition,
		});
		expect(renamed.ok && renamed.rule.outcome.outcome).toBe("request_fix");
		await ruleServices.setRuleOutcome(db, {
			repoId,
			ruleId: fix.rule.id,
			outcome: "human_review",
		});
		expect((await view(repoId, fix.rule.id)).outcome).toEqual({
			outcome: "human_review",
			instruction: "",
		});
		const bad = await customRuleServices.saveCustomRule(db, {
			repoId,
			name: "Bad outcome",
			definition,
			outcome: { outcome: "allow" },
		});
		expect(bad.ok).toBe(false);
	});
});
