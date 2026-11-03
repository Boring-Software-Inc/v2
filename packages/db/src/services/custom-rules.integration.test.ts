import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
	CustomRuleDefinition,
	WorkflowDefinition,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { repos } from "../schema/repos.ts";
import {
	customRuleDefinitionIssue,
	deleteCustomRule,
	listCustomRuleViews,
	saveCustomRule,
	setCustomRuleEnabled,
} from "./custom-rules.ts";
import { createWorkflow, deleteWorkflow } from "./workflows.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let repoId: string;
let otherRepoId: string;

const INTO_RELEASE = {
	when: { id: "pr.targetBranch" },
	comparison: { kind: "noneOf", args: [["release"]] },
} satisfies CustomRuleDefinition;

const FROM_RELEASE_PLEASE = {
	when: { id: "pr.sourceBranch" },
	comparison: { kind: "oneOf", args: [["release-please--branches--release"]] },
};

function graphUsing(ruleId: string): WorkflowDefinition {
	return {
		id: generateId(),
		name: "release gate",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: `${ruleId}@1`, config: {} },
			{ id: "a", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	};
}

async function insertRepo(name: string): Promise<string> {
	const id = generateId();
	await db.insert(repos).values({
		id,
		externalId: `custom-rules-${name}`,
		owner: "acme",
		name,
		fullName: `acme/${name}`,
	});
	return id;
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	repoId = await insertRepo("crm");
	otherRepoId = await insertRepo("site");
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("saveCustomRule", () => {
	test("the definition boundary rejects non-domain inputs without throwing", () => {
		for (const definition of [undefined, null, false, 42, "release", [], {}]) {
			expect(customRuleDefinitionIssue(definition)).toMatchObject({
				ok: false,
			});
		}
		expect(customRuleDefinitionIssue(INTO_RELEASE)).toEqual({
			ok: true,
			definition: INTO_RELEASE,
		});
	});

	test("description limits apply after trimming and permit omitted or cleared descriptions", async () => {
		const name = "Description boundary";
		const tooLong = await saveCustomRule(db, {
			repoId,
			name,
			definition: INTO_RELEASE,
			description: "x".repeat(501),
		});
		expect(tooLong).toMatchObject({ ok: false, reason: "invalid" });
		const created = await saveCustomRule(db, {
			repoId,
			name,
			definition: INTO_RELEASE,
			description: ` ${"x".repeat(500)} `,
		});
		if (!created.ok) throw new Error(created.error);
		expect(created.rule.description).toBe("x".repeat(500));
		for (const description of [undefined, null, "   "]) {
			const edited = await saveCustomRule(db, {
				repoId,
				id: created.rule.id,
				name,
				definition: INTO_RELEASE,
				description,
			});
			if (!edited.ok) throw new Error(edited.error);
			expect(edited.rule.description).toBe(
				description === undefined ? "x".repeat(500) : null,
			);
		}
		await deleteCustomRule(db, { repoId, id: created.rule.id });
	});

	test("a new rule gets a custom-<slug>-<6> id, starts off and reads as a sentence", async () => {
		const result = await saveCustomRule(db, {
			repoId,
			name: "Not into release",
			description: "Release branches come from release-please.",
			definition: INTO_RELEASE,
		});
		if (!result.ok) {
			throw new Error(result.error);
		}
		expect(result.created).toBe(true);
		expect(result.rule.id).toMatch(/^custom-not-into-release-[0-9a-f]{6}$/);
		expect(result.rule).toMatchObject({
			ref: `${result.rule.id}@1`,
			name: "Not into release",
			description: "Release branches come from release-please.",
			enabled: false,
			sentence: "require that target branch is not release",
			definition: INTO_RELEASE,
		});
		expect(await listCustomRuleViews(db, repoId)).toEqual([result.rule]);
	});

	test("rules whose names share a slug, saved back to back, get their own ids", async () => {
		const first = await saveCustomRule(db, {
			repoId: otherRepoId,
			name: "Release please",
			definition: FROM_RELEASE_PLEASE,
		});
		const second = await saveCustomRule(db, {
			repoId: otherRepoId,
			name: "Release, please",
			definition: FROM_RELEASE_PLEASE,
		});
		if (!(first.ok && second.ok)) {
			throw new Error("expected both to save");
		}
		expect(first.rule.id).not.toBe(second.rule.id);
		expect(await listCustomRuleViews(db, otherRepoId)).toHaveLength(2);
	});

	test("a name taken on the repo or by a built-in rule is refused", async () => {
		for (const name of ["not INTO release ", "Account age"]) {
			const result = await saveCustomRule(db, {
				repoId,
				name,
				definition: INTO_RELEASE,
			});
			expect(result).toMatchObject({ ok: false, reason: "name-taken" });
		}
		const elsewhere = await saveCustomRule(db, {
			repoId: otherRepoId,
			name: "Not into release",
			definition: INTO_RELEASE,
		});
		expect(elsewhere.ok).toBe(true);
	});

	test("a definition the evaluator would reject is refused with the reason", async () => {
		const cases: [unknown, string][] = [
			[
				{ when: { id: "pr.nope" }, comparison: { kind: "has", args: ["x"] } },
				"unknown signal pr.nope",
			],
			[
				{
					when: { id: "pr.targetBranch" },
					comparison: { kind: "over", args: [3] },
				},
				"over does not apply to this signal",
			],
			[
				{ when: { id: "pr.targetBranch" }, comparison: { kind: "has" } },
				"comparison",
			],
		];
		for (const [definition, error] of cases) {
			const result = await saveCustomRule(db, {
				repoId,
				name: "Broken",
				definition,
			});
			expect(result.ok).toBe(false);
			expect(result.ok ? "" : result.error).toContain(error);
			expect(result.ok ? null : result.reason).toBe("invalid");
		}
	});

	test("a name over 80 characters is refused", async () => {
		const result = await saveCustomRule(db, {
			repoId,
			name: "x".repeat(81),
			definition: INTO_RELEASE,
		});
		expect(result).toMatchObject({ ok: false, reason: "invalid" });
	});

	test("an edit keeps the id, and keeps what it leaves out", async () => {
		const [rule] = await listCustomRuleViews(db, repoId);
		if (!rule) {
			throw new Error("missing rule");
		}
		await setCustomRuleEnabled(db, { repoId, id: rule.id, enabled: true });
		const result = await saveCustomRule(db, {
			repoId,
			id: rule.id,
			name: "Never into release",
			definition: {
				when: { id: "pr.targetBranch" },
				comparison: { kind: "noneOf", args: [["release", "release-next"]] },
			},
		});
		if (!result.ok) {
			throw new Error(result.error);
		}
		expect(result.created).toBe(false);
		expect(result.rule).toMatchObject({
			id: rule.id,
			name: "Never into release",
			enabled: true,
			description: "Release branches come from release-please.",
			sentence: "require that target branch is not release, release-next",
		});
		expect(await listCustomRuleViews(db, repoId)).toEqual([result.rule]);
	});

	test("an edit of a rule on another repo is not found", async () => {
		const [rule] = await listCustomRuleViews(db, repoId);
		const result = await saveCustomRule(db, {
			repoId: otherRepoId,
			id: rule?.id ?? "custom-x",
			name: "Moved",
			definition: INTO_RELEASE,
		});
		expect(result).toMatchObject({ ok: false, reason: "not-found" });
	});
});

describe("setCustomRuleEnabled", () => {
	test("turns a rule off and on, and an unknown id is not found", async () => {
		const [rule] = await listCustomRuleViews(db, repoId);
		if (!rule) {
			throw new Error("missing rule");
		}
		const off = await setCustomRuleEnabled(db, {
			repoId,
			id: rule.id,
			enabled: false,
		});
		expect(off).toMatchObject({ ok: true, rule: { enabled: false } });
		expect((await listCustomRuleViews(db, repoId))[0]?.enabled).toBe(false);
		expect(
			await setCustomRuleEnabled(db, {
				repoId,
				id: "custom-missing-000000",
				enabled: true,
			}),
		).toMatchObject({ ok: false, reason: "not-found" });
	});
});

describe("deleteCustomRule", () => {
	test("a rule a workflow uses is kept, and the workflow is named", async () => {
		const [rule] = await listCustomRuleViews(db, repoId);
		if (!rule) {
			throw new Error("missing rule");
		}
		const workflow = await createWorkflow(db, {
			repoId,
			name: "release gate",
			definition: graphUsing(rule.id),
		});
		const blocked = await deleteCustomRule(db, { repoId, id: rule.id });
		expect(blocked).toMatchObject({
			ok: false,
			reason: "in-use",
			error:
				"This rule is used in release gate. Remove it from those workflows before you delete it.",
		});
		await deleteWorkflow(db, { repoId, workflowId: workflow.id });
		expect(await deleteCustomRule(db, { repoId, id: rule.id })).toEqual({
			ok: true,
		});
		expect(await listCustomRuleViews(db, repoId)).toEqual([]);
	});

	test("an unknown rule is not found", async () => {
		expect(
			await deleteCustomRule(db, { repoId, id: "custom-missing-000000" }),
		).toMatchObject({ ok: false, reason: "not-found" });
	});
});
