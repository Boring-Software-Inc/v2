import { afterAll, beforeAll, expect, test } from "bun:test";
import { RULE_CATALOG } from "@tripwire/contracts";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { user } from "../schema/auth.ts";
import { member, organization } from "../schema/organizations.ts";
import { DEMO_EMAIL_DOMAIN, ensureDemoRepo, resetDemoData } from "../seed.ts";
import {
	seedActivePersonaExtras,
	seedApprovedInstallRequest,
	seedRepoExtras,
	seedTeamOrg,
	seedWorkflowCatalog,
} from "../seed-extras.ts";
import * as orgServices from "./organizations.ts";
import * as repoServices from "./repos.ts";
import * as workflowServices from "./workflows.ts";

const countRow = z.object({ n: z.coerce.number() });

async function count(db: Db, query: ReturnType<typeof sql>): Promise<number> {
	const result = await db.execute(query);
	return countRow.parse(result.rows[0]).n;
}

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

async function demoUser(id: string): Promise<string> {
	await db
		.insert(user)
		.values({ id, name: id, email: `${id}@${DEMO_EMAIL_DOMAIN}` })
		.onConflictDoNothing();
	return id;
}

test("repo extras are complete and a second run adds nothing", async () => {
	await resetDemoData(db);
	const repo = await ensureDemoRepo(db, "extras");
	await seedRepoExtras(db, repo.id);
	await seedRepoExtras(db, repo.id);

	const latestRules = new Set(RULE_CATALOG.map((entry) => entry.ruleId)).size;
	expect(await repoServices.listRuleConfigs(db, repo.id)).toHaveLength(
		latestRules,
	);
	expect(await repoServices.listCustomRules(db, repo.id)).toHaveLength(2);
	expect(await repoServices.getResponseConfig(db, repo.id)).not.toBeNull();
	expect(
		await count(
			db,
			sql`SELECT count(*) AS n FROM repo_suggestions WHERE repo_id = ${repo.id}`,
		),
	).toBe(1);
});

test("custom rules stay on their own repo", async () => {
	await resetDemoData(db);
	const first = await ensureDemoRepo(db, "extras-a");
	const second = await ensureDemoRepo(db, "extras-b");
	await seedRepoExtras(db, first.id);
	await seedRepoExtras(db, second.id);

	expect(await repoServices.listCustomRules(db, first.id)).toHaveLength(2);
	expect(await repoServices.listCustomRules(db, second.id)).toHaveLength(2);
});

test("the team org is a real team with members, a link and repos", async () => {
	await resetDemoData(db);
	const admin = await demoUser("seed-admin");
	const teammate = await demoUser("seed-teammate");
	const now = new Date();
	const team = await seedTeamOrg(db, {
		adminUserId: admin,
		memberUserIds: [teammate],
		now,
	});
	const again = await seedTeamOrg(db, {
		adminUserId: admin,
		memberUserIds: [teammate],
		now,
	});

	expect(again.id).toBe(team.id);
	const [org] = await db
		.select({ isPersonal: organization.isPersonal })
		.from(organization)
		.where(eq(organization.id, team.id));
	expect(org?.isPersonal).toBe(false);
	expect(
		await db.select().from(member).where(eq(member.organizationId, team.id)),
	).toHaveLength(2);
	expect(await orgServices.listInviteLinks(db, team.id)).toHaveLength(1);
	expect(await orgServices.listOrgRepos(db, team.id)).toHaveLength(2);
});

test("the approved install request shows up once for its requester", async () => {
	await resetDemoData(db);
	const requester = await demoUser("seed-requester");
	const now = new Date();
	await seedApprovedInstallRequest(db, { userId: requester, now });
	await seedApprovedInstallRequest(db, { userId: requester, now });

	const approved = await orgServices.listApprovedInstallRequests(db, {
		userId: requester,
	});
	expect(approved).toHaveLength(1);
	expect(approved[0]?.repoCount).toBe(2);
});

test("repo extras leave an edited repo alone", async () => {
	await resetDemoData(db);
	const repo = await ensureDemoRepo(db, "extras-edited");
	await seedRepoExtras(db, repo.id);
	const [first] = await repoServices.listCustomRules(db, repo.id);
	if (!first) {
		throw new Error("no custom rule seeded");
	}
	await repoServices.upsertCustomRule(db, repo.id, {
		...first,
		enabled: false,
	});
	await seedRepoExtras(db, repo.id);

	const rules = await repoServices.listCustomRules(db, repo.id);
	expect(rules.find((rule) => rule.id === first.id)?.enabled).toBe(false);
});

test("the workflow catalog seeds once", async () => {
	await resetDemoData(db);
	const repo = await ensureDemoRepo(db, "extras-workflows");
	const first = await seedWorkflowCatalog(db, repo.id);
	const second = await seedWorkflowCatalog(db, repo.id);

	expect(first.created).toBe(first.total);
	expect(second.created).toBe(0);
	expect(await workflowServices.listWorkflows(db, repo.id)).toHaveLength(
		first.total,
	);
});

test("the active persona gets every extra in one call", async () => {
	await resetDemoData(db);
	const admin = await demoUser("seed-active");
	const org = await orgServices.ensurePersonalOrg(db, {
		userId: admin,
		name: admin,
	});
	const repo = await ensureDemoRepo(db, "extras-active");
	const input = { userId: admin, orgId: org.id, repo, now: new Date() };
	await seedActivePersonaExtras(db, input);
	await seedActivePersonaExtras(db, input);

	expect(await repoServices.getResponseConfig(db, repo.id)).not.toBeNull();
	expect(
		(await workflowServices.listWorkflows(db, repo.id)).length,
	).toBeGreaterThan(0);
	expect(await orgServices.listUserOrgs(db, admin)).toHaveLength(2);
	expect(
		await orgServices.listApprovedInstallRequests(db, { userId: admin }),
	).toHaveLength(1);
});
