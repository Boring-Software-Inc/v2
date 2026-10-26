import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { account, user } from "../schema/auth.ts";
import { events } from "../schema/events.ts";
import {
	member,
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { listForgeConnections } from "./accounts.ts";
import { recordInstallAccessCheck } from "./installation-access.ts";
import { listOrgSwitcherRepos } from "./organizations.ts";

const installation = z
	.object({
		sender: z.object({ id: z.number() }).passthrough(),
		installation: z
			.object({
				id: z.number(),
				account: z.object({ login: z.string() }).passthrough(),
			})
			.passthrough(),
		repositories: z.array(
			z
				.object({ id: z.number(), name: z.string(), full_name: z.string() })
				.passthrough(),
		),
	})
	.passthrough()
	.parse(
		await Bun.file(
			fileURLToPath(
				new URL(
					"../../../forge-github/fixtures/installation.created.json",
					import.meta.url,
				),
			),
		).json(),
	);

let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
const userId = generateId();
const orgId = generateId();

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 60_000);

beforeEach(async () => {
	await db.execute(sql`TRUNCATE repos, events, organization, "user" CASCADE`);
	await db.insert(user).values({
		id: userId,
		name: "Connections regression fixture",
		email: `${userId}@example.com`,
	});
	await db.insert(account).values({
		id: generateId(),
		userId,
		providerId: "github",
		accountId: String(installation.sender.id),
	});
	await db.insert(organization).values({
		id: orgId,
		name: "Connections regression fixture",
		slug: `fixture-${orgId}`,
		isPersonal: false,
	});
	await db.insert(member).values({
		id: generateId(),
		organizationId: orgId,
		userId,
		role: "member",
	});
	await db.insert(organizationInstallations).values({
		id: generateId(),
		organizationId: orgId,
		forge: "github",
		installationId: String(installation.installation.id),
	});
	const repo = installation.repositories[0];
	if (!repo) throw new Error("Captured installation has no repository");
	await db.insert(repos).values({
		id: generateId(),
		forge: "github",
		externalId: String(repo.id),
		owner: installation.installation.account.login,
		name: repo.name,
		fullName: repo.full_name,
		installationId: String(installation.installation.id),
		orgId,
	});
}, 60_000);

afterAll(async () => {
	await pool?.end();
	await container?.stop();
});

test("a GitHub repo in the org picker must not show No repos in Connections", async () => {
	const picker = await listOrgSwitcherRepos(db, orgId);
	expect(picker).toHaveLength(1);
	expect(installation.sender.id).not.toBe(installation.installation.id);
	const connections = await listForgeConnections(db, userId);
	expect(connections).toHaveLength(1);
	expect(connections[0]?.repoCount).toBe(picker.length);
});

test("multiple installations and orgs count only active repos in the caller's memberships", async () => {
	const otherOrgId = generateId();
	const outsideOrgId = generateId();
	await db.insert(organization).values({
		id: outsideOrgId,
		name: "Inaccessible fixture org",
		slug: `fixture-${outsideOrgId}`,
	});
	await db.insert(organization).values({
		id: otherOrgId,
		name: "Second accessible fixture org",
		slug: `fixture-${otherOrgId}`,
	});
	await db.insert(member).values({
		id: generateId(),
		organizationId: otherOrgId,
		userId,
		role: "moderator",
	});
	for (const [name, targetOrg, installationId, removedAt] of [
		["second-install", orgId, "145946162", null],
		["second-org", otherOrgId, "145946163", null],
		["outside-org", outsideOrgId, String(installation.sender.id), null],
		["removed", orgId, "145946164", new Date()],
	] as const) {
		await db.insert(repos).values({
			id: generateId(),
			externalId: generateId(),
			owner: installation.installation.account.login,
			name,
			fullName: `fixture/${name}`,
			orgId: targetOrg,
			installationId,
			removedAt,
		});
	}
	const firstPicker = await listOrgSwitcherRepos(db, orgId);
	const secondPicker = await listOrgSwitcherRepos(db, otherOrgId);
	expect(firstPicker).toHaveLength(2);
	expect(secondPicker).toHaveLength(1);
	expect((await listForgeConnections(db, userId))[0]?.repoCount).toBe(
		firstPicker.length + secondPicker.length,
	);
});

test("a teammate's installation is visible without owning the installing GitHub account", async () => {
	await db
		.update(account)
		.set({ accountId: String(installation.sender.id + 1) })
		.where(eq(account.userId, userId));
	expect(await listOrgSwitcherRepos(db, orgId)).toHaveLength(1);
	expect((await listForgeConnections(db, userId))[0]?.repoCount).toBe(1);
});

test("revoking org membership removes its repositories from the account count", async () => {
	expect((await listForgeConnections(db, userId))[0]?.repoCount).toBe(1);
	await db.delete(member).where(eq(member.userId, userId));
	expect((await listForgeConnections(db, userId))[0]?.repoCount).toBe(0);
});

test("numeric webhook identities prove an unclaimed installation without equating user and installation ids", async () => {
	await db.update(repos).set({ orgId: null });
	await db.delete(organizationInstallations);
	expect((await listForgeConnections(db, userId))[0]?.repoCount).toBe(0);
	await db.insert(events).values({
		id: generateId(),
		deliveryId: generateId(),
		forge: "github",
		rawKind: "installation",
		kind: "installation.created",
		raw: installation,
	});
	const [connection] = await listForgeConnections(db, userId);
	expect(connection?.repoCount).toBe(1);
	expect(connection?.unclaimedCount).toBe(1);
});

test("claiming an installation moves its count out of unclaimed without double counting", async () => {
	await db.insert(events).values({
		id: generateId(),
		deliveryId: generateId(),
		forge: "github",
		rawKind: "installation",
		kind: "installation.created",
		raw: installation,
	});
	expect((await listForgeConnections(db, userId))[0]).toMatchObject({
		repoCount: 1,
		unclaimedCount: 0,
	});
});

test("unclaimed repos require current admin proof, never ordinary access, stale proof, or another caller's proof", async () => {
	await db.update(repos).set({ orgId: null });
	await db.delete(organizationInstallations);
	const key = {
		userId,
		forge: "github" as const,
		installationId: String(installation.installation.id),
	};
	await recordInstallAccessCheck(db, { ...key, result: "not-admin" });
	expect((await listForgeConnections(db, userId))[0]?.unclaimedCount).toBe(0);
	await recordInstallAccessCheck(db, {
		...key,
		result: "granted-admin",
		at: new Date(0),
	});
	expect((await listForgeConnections(db, userId))[0]?.unclaimedCount).toBe(0);
	await recordInstallAccessCheck(db, { ...key, result: "granted-admin" });
	expect((await listForgeConnections(db, userId))[0]).toMatchObject({
		repoCount: 1,
		unclaimedCount: 1,
	});
	const strangerId = generateId();
	await db.insert(user).values({
		id: strangerId,
		name: "Stranger fixture",
		email: `${strangerId}@example.com`,
	});
	await db.insert(account).values({
		id: generateId(),
		userId: strangerId,
		providerId: "github",
		accountId: String(installation.sender.id + 1),
	});
	expect((await listForgeConnections(db, strangerId))[0]).toMatchObject({
		repoCount: 0,
		unclaimedCount: 0,
	});
});

test("non-forge credentials are skipped and a caller with no OAuth link gets no rows", async () => {
	await db.insert(account).values({
		id: generateId(),
		userId,
		providerId: "credential",
		accountId: userId,
	});
	expect(await listForgeConnections(db, userId)).toHaveLength(1);
	expect(await listForgeConnections(db, generateId())).toEqual([]);
});

test("unsupported legacy accounts and their unclaimed repos do not hide the GitHub connection", async () => {
	await db.insert(account).values({
		id: generateId(),
		userId,
		providerId: "retired-forge",
		accountId: "retired-account",
	});
	await db.execute(
		sql`INSERT INTO repos (id, forge, external_id, owner, name, full_name, installation_id) VALUES (${generateId()}, 'retired-forge', 'retired-repo', 'fixture', 'retired', 'fixture/retired', 'retired-account')`,
	);
	expect(await listForgeConnections(db, userId)).toHaveLength(1);
	expect((await listForgeConnections(db, userId))[0]).toMatchObject({
		forge: "github",
		repoCount: 1,
		unclaimedCount: 0,
	});
});
