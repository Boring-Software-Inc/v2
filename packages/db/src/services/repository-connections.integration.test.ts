import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	gitCafeInstallationLifecycle,
	organization,
	organizationInstallations,
	repos,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import { listOrganizationForgeConnections } from "./repository-connections.ts";

let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
const orgId = generateId();
const otherOrgId = generateId();
const activeInstallation = generateId();
const revokedInstallation = generateId();
const repoId = generateId();

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	await db.insert(organization).values([
		{ id: orgId, name: "Connection fixture", slug: `connections-${orgId}` },
		{ id: otherOrgId, name: "Other tenant", slug: `other-${otherOrgId}` },
	]);
	await db.insert(organizationInstallations).values([
		{
			id: generateId(),
			organizationId: orgId,
			forge: "gitcafe",
			installationId: activeInstallation,
			accountLogin: "boring",
			accountType: "Organization",
		},
		{
			id: generateId(),
			organizationId: orgId,
			forge: "gitcafe",
			installationId: revokedInstallation,
			accountLogin: "boring",
			accountType: "Organization",
		},
		{
			id: generateId(),
			organizationId: orgId,
			forge: "github",
			installationId: revokedInstallation,
			accountLogin: "boring",
			accountType: "Organization",
		},
	]);
	await db.insert(gitCafeInstallationLifecycle).values([
		{
			installationId: activeInstallation,
			status: "active",
			generation: 1,
			authorityAt: new Date(),
		},
		{
			installationId: revokedInstallation,
			status: "uninstalled",
			generation: 2,
		},
	]);
	await db.insert(repos).values([
		{
			id: repoId,
			externalId: generateId(),
			forge: "gitcafe",
			owner: "boring",
			name: "scratch",
			fullName: "boring/scratch",
			orgId,
			installationId: activeInstallation,
		},
		{
			id: generateId(),
			externalId: generateId(),
			forge: "gitcafe",
			owner: "boring",
			name: "removed",
			fullName: "boring/removed",
			orgId,
			installationId: activeInstallation,
			removedAt: new Date(),
		},
		{
			id: generateId(),
			externalId: generateId(),
			forge: "gitcafe",
			owner: "boring",
			name: "revoked",
			fullName: "boring/revoked",
			orgId,
			installationId: revokedInstallation,
		},
		{
			id: generateId(),
			externalId: generateId(),
			forge: "github",
			owner: "boring",
			name: "scratch",
			fullName: "boring/scratch",
			orgId,
			installationId: revokedInstallation,
		},
		{
			id: generateId(),
			externalId: generateId(),
			forge: "gitcafe",
			owner: "private-tenant",
			name: "hidden",
			fullName: "private-tenant/hidden",
			orgId: otherOrgId,
			installationId: generateId(),
		},
	]);
}, 120_000);

afterAll(async () => {
	await pool?.end();
	await container?.stop();
});

test("organization connections use scoped installations without any linked sign-in account", async () => {
	const result = await listOrganizationForgeConnections(db, orgId);
	expect(result.map((group) => group.forge)).toEqual(["gitcafe", "github"]);
	const gitcafe = result.find((group) => group.forge === "gitcafe");
	expect(gitcafe?.repositories).toEqual([
		{
			id: repoId,
			fullName: "boring/scratch",
			installationId: activeInstallation,
		},
	]);
	expect(gitcafe?.installations.map((item) => item.installationId)).toEqual([
		activeInstallation,
	]);
	expect(
		result
			.find((group) => group.forge === "github")
			?.repositories.map((repo) => repo.fullName),
	).toEqual(["boring/scratch"]);
	expect(JSON.stringify(result)).not.toContain("private-tenant");
	expect(JSON.stringify(result)).not.toContain("boring/removed");
	expect(JSON.stringify(result)).not.toContain("boring/revoked");
});

test("empty and unrelated organizations cannot see another tenant's connections", async () => {
	expect(await listOrganizationForgeConnections(db, generateId())).toEqual([]);
	const result = await listOrganizationForgeConnections(db, otherOrgId);
	expect(
		result.flatMap((group) => group.repositories).map((repo) => repo.fullName),
	).toEqual(["private-tenant/hidden"]);
	expect(result.flatMap((group) => group.installations)).toEqual([]);
});

test("selection reconciliation retains unremoved siblings and their installation settings", async () => {
	await db
		.update(gitCafeInstallationLifecycle)
		.set({ status: "reconcile-required" })
		.where(eq(gitCafeInstallationLifecycle.installationId, activeInstallation));
	try {
		const result = await listOrganizationForgeConnections(db, orgId);
		const gitcafe = result.find((group) => group.forge === "gitcafe");
		expect(gitcafe?.repositories.map((repo) => repo.id)).toEqual([repoId]);
		expect(gitcafe?.installations.map((item) => item.installationId)).toEqual([
			activeInstallation,
		]);
		expect(JSON.stringify(result)).not.toContain("boring/removed");
	} finally {
		await db
			.update(gitCafeInstallationLifecycle)
			.set({ status: "active" })
			.where(
				eq(gitCafeInstallationLifecycle.installationId, activeInstallation),
			);
	}
});
