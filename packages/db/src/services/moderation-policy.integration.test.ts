import { afterAll, beforeAll, expect, test } from "bun:test";
import { SHARED_BLOCKLIST_RULE_ID } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { createDb, type Db } from "../client.ts";
import { applyMigrations } from "../migrate.ts";
import { organization } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { createTestDatabase, type TestDatabase } from "../testing.ts";
import {
	addAllowlistEntry,
	getEffectiveRepoPolicy,
	getOrgPolicy,
	getRepoPolicy,
	isAuthorAllowlisted,
	listAllowlistEntries,
	removeAllowlistEntry,
	resolveRuleOutcome,
	updateOrgDefault,
	updateRepoPolicy,
	upsertOrgPolicy,
} from "./moderation-policy.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
const orgId = generateId();

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	await db.insert(organization).values({
		id: orgId,
		name: "Acme",
		slug: "acme",
		isPersonal: false,
	});
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

async function seedRepo(name: string): Promise<string> {
	const id = generateId();
	await db.insert(repos).values({
		id,
		externalId: generateId(),
		owner: "acme",
		name,
		fullName: `acme/${name}`,
		orgId,
	});
	return id;
}

test("preserves PR blocking and Pilot review when there is no policy", async () => {
	const repoId = await seedRepo("legacy");
	const policy = await getEffectiveRepoPolicy(db, repoId);

	expect(policy.issueRulesEnabled).toBe(false);
	expect(resolveRuleOutcome(policy, "account-age", "change-request")).toBe(
		"block",
	);
	expect(resolveRuleOutcome(policy, "account-age", "issue")).toBe("warn");
	expect(
		resolveRuleOutcome(policy, SHARED_BLOCKLIST_RULE_ID, "change-request"),
	).toBe("human-review");
});

test("merges independent repo settings and resolves the most specific outcome", async () => {
	const repoId = await seedRepo("overrides");
	await upsertOrgPolicy(db, orgId, {
		defaults: { issue: "human-review", "change-request": "warn" },
	});
	await Promise.all([
		updateRepoPolicy(db, repoId, {
			issueRulesEnabled: true,
			defaults: { "change-request": "block" },
		}),
		updateRepoPolicy(db, repoId, {
			ruleOutcome: {
				ruleId: "custom-test@1",
				subject: "issue",
				outcome: "close",
			},
		}),
		updateRepoPolicy(db, repoId, {
			ruleOutcome: {
				ruleId: SHARED_BLOCKLIST_RULE_ID,
				subject: "change-request",
				outcome: "inherit",
			},
		}),
	]);

	const policy = await getEffectiveRepoPolicy(db, repoId);
	expect(policy.issueRulesEnabled).toBe(true);
	expect(resolveRuleOutcome(policy, "account-age", "issue")).toBe(
		"human-review",
	);
	expect(resolveRuleOutcome(policy, "custom-test@1", "issue")).toBe("close");
	expect(
		resolveRuleOutcome(policy, SHARED_BLOCKLIST_RULE_ID, "change-request"),
	).toBe("block");

	await updateRepoPolicy(db, repoId, {
		defaults: { "change-request": null },
		ruleOutcome: {
			ruleId: "custom-test@1",
			subject: "issue",
			outcome: null,
		},
	});
	expect(await getRepoPolicy(db, repoId)).toEqual({
		defaults: {},
		issueRulesEnabled: true,
		ruleOutcomes: {
			[SHARED_BLOCKLIST_RULE_ID]: { "change-request": "inherit" },
		},
	});
	const inherited = await getEffectiveRepoPolicy(db, repoId);
	expect(resolveRuleOutcome(inherited, "custom-test@1", "issue")).toBe(
		"human-review",
	);
	expect(
		resolveRuleOutcome(inherited, SHARED_BLOCKLIST_RULE_ID, "change-request"),
	).toBe("warn");
});

test("merges concurrent defaults for separate subjects on the org", async () => {
	await Promise.all([
		updateOrgDefault(db, orgId, "issue", "block"),
		updateOrgDefault(db, orgId, "change-request", "close"),
	]);
	expect(await getOrgPolicy(db, orgId)).toEqual({
		defaults: { issue: "block", "change-request": "close" },
	});
});

test("matches a stable account ID and scopes entries to the repository", async () => {
	const repoId = await seedRepo("allowlist");
	const otherRepoId = await seedRepo("elsewhere");
	const accountId = "9007199254740993";

	await addAllowlistEntry(db, repoId, { accountId, login: "Original" });
	await db.transaction(async (tx) => {
		await addAllowlistEntry(tx, repoId, { accountId, login: "Renamed" });
	});
	expect(await isAuthorAllowlisted(db, repoId, accountId)).toBe(true);
	expect(await isAuthorAllowlisted(db, otherRepoId, accountId)).toBe(false);
	expect(await listAllowlistEntries(db, repoId)).toEqual([
		{ accountId, login: "Renamed", createdAt: expect.any(String) },
	]);
	await removeAllowlistEntry(db, repoId, accountId);
	expect(await isAuthorAllowlisted(db, repoId, accountId)).toBe(false);
});
