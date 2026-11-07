import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	repoServices,
	type TestDatabase,
} from "@tripwire/db";
import { executableRuleNames } from "#/lib/activity.functions";

/**
 * Integration: the web re-run gate/preview against REAL Postgres. Mirrors
 * what getRerunPreview / rerunChangeRequest fetch (listEnabledWorkflows +
 * listRuleConfigs + listCustomRules) and feeds through executableRuleNames.
 * The motivating bug: a custom-rule-only repo used to return [] here while
 * the worker evaluated the custom rules — the gate must now agree.
 */
let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];

const CUSTOM_DEF = {
	when: { id: "pr.targetBranch" },
	comparison: { kind: "noneOf", args: [["release"]] },
};

async function namesFor(
	repoFullName: string,
	forge: "github",
): Promise<string[]> {
	const repo = await repoServices.getRepoByFullName(db, repoFullName, forge);
	if (!repo) {
		throw new Error(`repo ${repoFullName} not found`);
	}
	const [workflows, configs, customRules] = await Promise.all([
		repoServices.listEnabledWorkflows(db, repo.fullName, repo.forge),
		repoServices.listRuleConfigs(db, repo.id),
		repoServices.listCustomRules(db, repo.id),
	]);
	return executableRuleNames(
		configs.map((c) => ({ ruleId: c.ruleId, enabled: c.enabled })),
		workflows,
		customRules.map((c) => ({ id: c.id, name: c.name, enabled: c.enabled })),
	);
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("executableRuleNames — integration (real Postgres)", () => {
	test("custom-rule-only repo: enabled standalone custom rule runs (the bug)", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "custom-only-1",
			owner: "acme",
			name: "custom-only",
			fullName: "acme/custom-only",
		});
		await repoServices.setRepoArmed(db, repoId, true);
		await repoServices.upsertCustomRule(db, repoId, {
			id: "custom-require-linear-history",
			name: "Require linear history",
			enabled: true,
			definition: CUSTOM_DEF,
		});
		const names = await namesFor("acme/custom-only", "github");
		expect(names).toEqual(["Require linear history"]);
	});

	test("custom-rule-only repo with a disabled custom rule yields nothing (legitimate no-workflow)", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "custom-disabled-1",
			owner: "acme",
			name: "custom-disabled",
			fullName: "acme/custom-disabled",
		});
		await repoServices.setRepoArmed(db, repoId, true);
		await repoServices.upsertCustomRule(db, repoId, {
			id: "custom-off-rule",
			name: "Off rule",
			enabled: false,
			definition: CUSTOM_DEF,
		});
		const names = await namesFor("acme/custom-disabled", "github");
		expect(names).toEqual([]);
	});

	test("builtin-rule repo still works (regression)", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "builtin-only-1",
			owner: "acme",
			name: "builtin-only",
			fullName: "acme/builtin-only",
		});
		await repoServices.setRepoArmed(db, repoId, true);
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "account-age",
			version: 1,
			enabled: true,
			config: { minDays: 7 },
		});
		const names = await namesFor("acme/builtin-only", "github");
		expect(names).toEqual(["Account age"]);
	});

	test("truly empty repo is still refused (regression)", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "empty-1",
			owner: "acme",
			name: "empty",
			fullName: "acme/empty",
		});
		await repoServices.setRepoArmed(db, repoId, true);
		const names = await namesFor("acme/empty", "github");
		expect(names).toEqual([]);
	});

	test("mixed: enabled builtin + enabled custom both appear, catalog first", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "mixed-1",
			owner: "acme",
			name: "mixed",
			fullName: "acme/mixed",
		});
		await repoServices.setRepoArmed(db, repoId, true);
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "honeypot",
			version: 1,
			enabled: true,
			config: { paths: [".github/workflows/**"] },
		});
		await repoServices.upsertCustomRule(db, repoId, {
			id: "custom-mixed-rule",
			name: "Mixed custom",
			enabled: true,
			definition: CUSTOM_DEF,
		});
		const names = await namesFor("acme/mixed", "github");
		expect(names).toEqual(["Honeypot paths", "Mixed custom"]);
	});
});
