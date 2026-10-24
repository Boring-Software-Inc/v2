import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { scopesToStatements } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	orgServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import { deleteAccount, planAccountDeletion } from "./account-deletion.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

async function seedUser(id: string): Promise<string> {
	await db
		.insert(schema.user)
		.values({ id, name: id, email: `${id}@example.com` });
	return (await orgServices.ensurePersonalOrg(db, { userId: id, name: id })).id;
}

async function seedTeamOrg(
	slug: string,
	members: { userId: string; role: string }[],
): Promise<string> {
	const orgId = generateId();
	await db
		.insert(schema.organization)
		.values({ id: orgId, name: slug, slug, isPersonal: false });
	for (const entry of members) {
		await db.insert(schema.member).values({
			id: generateId(),
			organizationId: orgId,
			userId: entry.userId,
			role: entry.role,
		});
	}
	return orgId;
}

async function seedRepo(orgId: string, fullName: string): Promise<string> {
	const id = generateId();
	const [owner = "o", name = "r"] = fullName.split("/");
	await db.insert(schema.repos).values({
		id,
		externalId: id,
		owner,
		name,
		fullName,
		armed: true,
		orgId,
	});
	return id;
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("planAccountDeletion", () => {
	test("lists on repos only where nobody else can turn them off", async () => {
		const personal = await seedUser("ana");
		await seedUser("ben");
		await seedUser("cy");
		const shared = await seedTeamOrg("shared", [
			{ userId: "ana", role: "admin" },
			{ userId: "ben", role: "admin" },
		]);
		const custom = await seedTeamOrg("custom", [
			{ userId: "ana", role: "admin" },
			{ userId: "cy", role: "gatekeeper" },
		]);
		await db.insert(schema.organizationRole).values({
			id: generateId(),
			organizationId: custom,
			role: "gatekeeper",
			permission: JSON.stringify(scopesToStatements({ connections: "manage" })),
		});
		const lonely = await seedTeamOrg("lonely", [
			{ userId: "ana", role: "admin" },
			{ userId: "cy", role: "member" },
		]);
		await seedRepo(personal, "ana/site");
		await seedRepo(shared, "shared/app");
		await seedRepo(custom, "custom/app");
		await seedRepo(lonely, "lonely/app");

		const plan = await planAccountDeletion(db, "ana");
		expect(plan.onRepos.map((repo) => repo.fullName).sort()).toEqual([
			"ana/site",
			"lonely/app",
		]);
		expect(plan.soleAdminOrgs.map((org) => org.slug).sort()).toEqual([
			"custom",
			"lonely",
		]);
		expect(plan.personalOrg?.slug).toBe("ana");
	});

	test("refuses while the account is the only admin, then while repos are on", async () => {
		const personal = await seedUser("dee");
		await seedUser("eli");
		await seedTeamOrg("dee-team", [
			{ userId: "dee", role: "admin" },
			{ userId: "eli", role: "member" },
		]);
		const repo = await seedRepo(personal, "dee/site");

		expect(await deleteAccount(db, "dee")).toEqual({
			ok: false,
			reason: "sole-admin",
			orgSlugs: ["dee-team"],
		});

		await db
			.update(schema.member)
			.set({ role: "admin" })
			.where(eq(schema.member.userId, "eli"));
		expect(await deleteAccount(db, "dee")).toEqual({
			ok: false,
			reason: "repos-on",
			repos: ["dee/site"],
		});

		await db
			.update(schema.repos)
			.set({ armed: false })
			.where(eq(schema.repos.id, repo));
		const result = await deleteAccount(db, "dee");
		expect(result.ok).toBe(true);
		expect(
			await db.select().from(schema.user).where(eq(schema.user.id, "dee")),
		).toEqual([]);
	});
});
