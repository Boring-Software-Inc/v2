import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { gitCafeInstallationSchema } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type TestDatabase,
} from "../index.ts";
import { gitCafeInstallationLifecycle } from "../schema/gitcafe-lifecycle.ts";
import {
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import {
	getGitCafeActionAuthority,
	reconcileGitCafeInstallation,
} from "./gitcafe-lifecycle.ts";

const installation = gitCafeInstallationSchema.parse(
	await Bun.file(
		new URL(
			"../../../forge-gitcafe/fixtures/gitcafe-installation.json",
			import.meta.url,
		),
	).json(),
);
let container: TestDatabase;
let database: ReturnType<typeof createDb>;
let orgId: string;
let repoId: string;

beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
}, 60_000);

beforeEach(async () => {
	await database.db.execute(
		sql`TRUNCATE gitcafe_installation_lifecycle, repos, organization CASCADE`,
	);
	orgId = generateId();
	repoId = generateId();
	await database.db
		.insert(organization)
		.values({ id: orgId, name: "Lifecycle test", slug: `lifecycle-${orgId}` });
	await database.db.insert(organizationInstallations).values({
		id: generateId(),
		forge: "gitcafe",
		installationId: installation.id,
		organizationId: orgId,
		accountLogin: installation.org,
	});
	await database.db.insert(repos).values({
		id: repoId,
		forge: "gitcafe",
		externalId: generateId(),
		owner: installation.org,
		name: "scratch",
		fullName: `${installation.org}/scratch`,
		installationId: installation.id,
		orgId,
		armed: true,
	});
});

afterAll(async () => {
	await database?.pool.end();
	await container?.stop();
});

test("one-off scoped fresh reconciliation needs a stored claim, not a person grant, and 403 is not uninstall evidence", async () => {
	const beforeClaims = await database.db
		.select()
		.from(organizationInstallations);
	const result = await reconcileGitCafeInstallation(database.db, {
		installationId: installation.id,
		expectedAppId: installation.appId,
		expectedOwner: installation.org,
		organizationId: orgId,
		lookup: async () => ({ ok: false, reason: "http", status: 403 }),
	});
	expect(result).toMatchObject({
		ok: true,
		status: "reconcile-required",
		removedCount: 1,
	});
	const [row] = await database.db
		.select()
		.from(repos)
		.where(eq(repos.id, repoId));
	expect(row?.removedAt).toBeInstanceOf(Date);
	expect(row?.armed).toBe(false);
	expect(await database.db.select().from(organizationInstallations)).toEqual(
		beforeClaims,
	);
});

for (const change of [
	{ appId: "wrong-app" },
	{ id: "ins_other" },
	{ org: "another-owner" },
]) {
	test(`identity mismatch ${Object.keys(change)[0]} withdraws known authority without asserting uninstall`, async () => {
		await database.db.insert(gitCafeInstallationLifecycle).values({
			installationId: installation.id,
			status: "active",
			generation: 2,
			authorityAt: new Date(),
		});
		expect(
			(await getGitCafeActionAuthority(database.db, installation.id)).allowed,
		).toBe(true);
		expect(
			await reconcileGitCafeInstallation(database.db, {
				installationId: installation.id,
				expectedAppId: installation.appId,
				expectedOwner: installation.org,
				organizationId: orgId,
				lookup: async () => ({
					ok: true,
					value: {
						...installation,
						...change,
						uninstalledAt: new Date().toISOString(),
					},
				}),
			}),
		).toEqual({ ok: false, reason: "identity-mismatch" });
		expect(
			(await database.db.select().from(gitCafeInstallationLifecycle))[0],
		).toMatchObject({ status: "reconcile-required", generation: 3 });
		expect(
			await getGitCafeActionAuthority(database.db, installation.id),
		).toEqual({ allowed: false });
		expect((await database.db.select().from(repos))[0]?.armed).toBe(false);
		expect(
			(await database.db.select().from(repos))[0]?.removedAt,
		).toBeInstanceOf(Date);
	});
}

test("scope and owner names cannot withdraw another organization's claim", async () => {
	const before = await database.db.select().from(repos);
	const otherOrg = generateId();
	expect(
		await reconcileGitCafeInstallation(database.db, {
			installationId: installation.id,
			expectedAppId: installation.appId,
			expectedOwner: installation.org,
			organizationId: otherOrg,
			lookup: async () => ({ ok: false, reason: "http", status: 403 }),
		}),
	).toEqual({ ok: false, reason: "identity-mismatch" });
	expect(await database.db.select().from(repos)).toEqual(before);
});

test("a bare matching owner without a stored claim neither withdraws repositories nor creates ownership", async () => {
	await database.db.delete(organizationInstallations);
	const before = await database.db.select().from(repos);
	expect(
		await reconcileGitCafeInstallation(database.db, {
			installationId: installation.id,
			expectedAppId: installation.appId,
			expectedOwner: installation.org,
			organizationId: orgId,
			lookup: async () => ({ ok: false, reason: "http", status: 403 }),
		}),
	).toMatchObject({ ok: true, status: "reconcile-required", removedCount: 0 });
	expect(await database.db.select().from(repos)).toEqual(before);
	expect(
		await database.db.select().from(organizationInstallations),
	).toHaveLength(0);
});

test("identity mismatch cannot replace a terminal uninstall with reconcile-required", async () => {
	await database.db.insert(gitCafeInstallationLifecycle).values({
		installationId: installation.id,
		status: "uninstalled",
		generation: 7,
	});
	expect(
		await reconcileGitCafeInstallation(database.db, {
			installationId: installation.id,
			expectedAppId: installation.appId,
			expectedOwner: installation.org,
			organizationId: orgId,
			lookup: async () => ({
				ok: true,
				value: { ...installation, appId: "wrong-app" },
			}),
		}),
	).toEqual({ ok: false, reason: "identity-mismatch" });
	expect(
		(await database.db.select().from(gitCafeInstallationLifecycle))[0],
	).toMatchObject({ status: "uninstalled", generation: 8 });
	expect(await getGitCafeActionAuthority(database.db, installation.id)).toEqual(
		{ allowed: false },
	);
	expect((await database.db.select().from(repos))[0]?.removedAt).toBeInstanceOf(
		Date,
	);
});
