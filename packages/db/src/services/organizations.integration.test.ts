import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import { backfillOrgs } from "../backfill-orgs.ts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { user } from "../schema/auth.ts";
import {
	member,
	organization,
	organizationInstallations,
	organizationInviteLinks,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { promoteUserAccess } from "./access.ts";
import {
	countAdmins,
	createInviteLink,
	deleteOrganization,
	ensurePersonalOrg,
	enumerateOrgCascade,
	getInstallationOrg,
	getOrgForUser,
	linkOrgInstallation,
	listInviteLinks,
	listUserOrgs,
	moveInstallation,
	pickOrgSlug,
	redeemInviteLink,
	revokeInviteLink,
} from "./organizations.ts";
import { syncInstallationRepos } from "./repos.ts";

/**
 * §org-model integration — real Postgres, never mocked: the tx + constraints
 * ARE the logic (invite redemption's guarded increment, the (forge,
 * installationId) unique, FK cascades on delete).
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

async function seedUser(
	id: string,
	accessStatus: "pending" | "approved" = "pending",
): Promise<void> {
	await db
		.insert(user)
		.values({ id, name: id, email: `${id}@example.com`, accessStatus });
}

async function seedTeamOrg(slug: string, adminId: string): Promise<string> {
	const orgId = generateId();
	await db
		.insert(organization)
		.values({ id: orgId, name: slug, slug, isPersonal: false });
	await db.insert(member).values({
		id: generateId(),
		organizationId: orgId,
		userId: adminId,
		role: "admin",
	});
	return orgId;
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

describe("personal orgs (§1)", () => {
	test("ensurePersonalOrg is idempotent and slugs from the name", async () => {
		await seedUser("grim");
		const first = await ensurePersonalOrg(db, { userId: "grim", name: "Grim" });
		const second = await ensurePersonalOrg(db, {
			userId: "grim",
			name: "Renamed Later",
		});
		expect(second.id).toBe(first.id);
		expect(first.slug).toBe("grim");
		expect(first.isPersonal).toBe(true);
		expect(await countAdmins(db, first.id)).toBe(1);
	});

	test("slug collisions suffix numerically and skip reserved words", async () => {
		await seedUser("grim2");
		const org = await ensurePersonalOrg(db, { userId: "grim2", name: "Grim" });
		expect(org.slug).toBe("grim-2");
		// Reserved: "admin" may never be an org slug.
		expect(await pickOrgSlug(db, "admin")).toBe("admin-2");
	});

	test("personal orgs refuse invite links", async () => {
		const org = await ensurePersonalOrg(db, { userId: "grim", name: "Grim" });
		expect(
			createInviteLink(db, {
				orgId: org.id,
				role: "member",
				createdBy: "grim",
			}),
		).rejects.toThrow(/personal orgs/);
	});

	test("personal orgs refuse deletion", async () => {
		const org = await ensurePersonalOrg(db, { userId: "grim", name: "Grim" });
		expect(deleteOrganization(db, org.id)).rejects.toThrow(/cannot be deleted/);
	});
});

describe("membership resolution (§8: 404, never 403)", () => {
	test("getOrgForUser returns null for non-members AND missing orgs alike", async () => {
		await seedUser("insider");
		await seedUser("outsider");
		await seedTeamOrg("acme", "insider");
		const asInsider = await getOrgForUser(db, {
			slug: "acme",
			userId: "insider",
		});
		expect(asInsider?.role).toBe("admin");
		expect(
			await getOrgForUser(db, { slug: "acme", userId: "outsider" }),
		).toBeNull();
		expect(
			await getOrgForUser(db, { slug: "no-such-org", userId: "insider" }),
		).toBeNull();
	});

	test("listUserOrgs puts the personal org first", async () => {
		const orgs = await listUserOrgs(db, "insider");
		// insider has no personal org (seeded directly) — just the team org.
		expect(orgs.map((o) => o.slug)).toContain("acme");
	});
});

describe("invite links (§6)", () => {
	test("create → redeem: membership with the carried role, use consumed", async () => {
		await seedUser("inviter-a", "approved");
		await seedUser("joiner-a");
		const orgId = await seedTeamOrg("team-a", "inviter-a");
		const { token } = await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "inviter-a",
			maxUses: 5,
		});
		const result = await redeemInviteLink(db, {
			token,
			userId: "joiner-a",
		});
		expect(result).toMatchObject({
			status: "joined",
			orgSlug: "team-a",
			role: "member",
			approved: true,
		});
		const links = await listInviteLinks(db, orgId);
		expect(links[0]?.uses).toBe(1);
	});

	test("redeeming as an existing member is a FULL no-op — role untouched, use NOT consumed", async () => {
		await seedUser("inviter-b", "approved");
		const orgId = await seedTeamOrg("team-b", "inviter-b");
		const { token } = await createInviteLink(db, {
			orgId,
			role: "member", // a link that would DOWNGRADE the admin if applied
			createdBy: "inviter-b",
			maxUses: 3,
		});
		const result = await redeemInviteLink(db, {
			token,
			userId: "inviter-b",
		});
		expect(result).toMatchObject({ status: "already-member" });
		const roleRow = await db
			.select({ role: member.role })
			.from(member)
			.where(eq(member.userId, "inviter-b"));
		expect(roleRow.some((r) => r.role === "admin")).toBe(true);
		expect((await listInviteLinks(db, orgId))[0]?.uses).toBe(0);
	});

	test("expired links refuse", async () => {
		await seedUser("inviter-c", "approved");
		await seedUser("joiner-c");
		const orgId = await seedTeamOrg("team-c", "inviter-c");
		const { token, id } = await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "inviter-c",
		});
		await db
			.update(organizationInviteLinks)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(organizationInviteLinks.id, id));
		expect(await redeemInviteLink(db, { token, userId: "joiner-c" })).toEqual({
			status: "invalid",
			reason: "expired",
		});
	});

	test("revoked links refuse", async () => {
		await seedUser("inviter-d", "approved");
		await seedUser("joiner-d");
		const orgId = await seedTeamOrg("team-d", "inviter-d");
		const { token, id } = await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "inviter-d",
		});
		const { revoked } = await revokeInviteLink(db, {
			orgId,
			inviteId: id,
		});
		expect(revoked).toBe(true);
		expect(await redeemInviteLink(db, { token, userId: "joiner-d" })).toEqual({
			status: "invalid",
			reason: "revoked",
		});
	});

	test("max uses exhausts", async () => {
		await seedUser("inviter-e", "approved");
		await seedUser("joiner-e1");
		await seedUser("joiner-e2");
		const orgId = await seedTeamOrg("team-e", "inviter-e");
		const { token } = await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "inviter-e",
			maxUses: 1,
		});
		expect(
			(await redeemInviteLink(db, { token, userId: "joiner-e1" })).status,
		).toBe("joined");
		expect(await redeemInviteLink(db, { token, userId: "joiner-e2" })).toEqual({
			status: "invalid",
			reason: "exhausted",
		});
	});

	test("CONCURRENT redemption of a maxUses:1 link — exactly one wins (amendment 2)", async () => {
		await seedUser("inviter-f", "approved");
		const racers = Array.from({ length: 8 }, (_, i) => `racer-${i}`);
		for (const r of racers) {
			await seedUser(r);
		}
		const orgId = await seedTeamOrg("team-f", "inviter-f");
		const { token } = await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "inviter-f",
			maxUses: 1,
		});
		const results = await Promise.all(
			racers.map((userId) => redeemInviteLink(db, { token, userId })),
		);
		const joined = results.filter((r) => r.status === "joined");
		expect(joined.length).toBe(1);
		const memberCount = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.organizationId, orgId));
		// the seeded admin + exactly one racer
		expect(memberCount.length).toBe(2);
		expect((await listInviteLinks(db, orgId))[0]?.uses).toBe(1);
	});

	test("UNAPPROVED inviter: membership granted, accessStatus UNTOUCHED (amendment 1)", async () => {
		await seedUser("pending-admin", "pending");
		await seedUser("joiner-g", "pending");
		const orgId = await seedTeamOrg("team-g", "pending-admin");
		const { token } = await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "pending-admin",
		});
		const result = await redeemInviteLink(db, {
			token,
			userId: "joiner-g",
		});
		expect(result).toMatchObject({ status: "joined", approved: false });
		const rows = await db
			.select({ accessStatus: user.accessStatus })
			.from(user)
			.where(eq(user.id, "joiner-g"));
		expect(rows[0]?.accessStatus).toBe("pending"); // still lands in /queue
	});

	test("inviter approval is read at REDEMPTION time, not creation time", async () => {
		await seedUser("late-admin", "pending");
		await seedUser("joiner-h", "pending");
		const orgId = await seedTeamOrg("team-h", "late-admin");
		const { token } = await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "late-admin",
			maxUses: 2,
		});
		// Promotion AFTER the link was created flips the outcome.
		await promoteUserAccess(db, {
			userId: "late-admin",
			reviewedBy: "late-admin",
		});
		const result = await redeemInviteLink(db, {
			token,
			userId: "joiner-h",
		});
		expect(result).toMatchObject({ status: "joined", approved: true });
		const rows = await db
			.select({
				accessStatus: user.accessStatus,
				accessReviewedBy: user.accessReviewedBy,
			})
			.from(user)
			.where(eq(user.id, "joiner-h"));
		expect(rows[0]?.accessStatus).toBe("approved");
		expect(rows[0]?.accessReviewedBy).toBe("late-admin"); // audit: who vouched
	});
});

describe("installations (§2/§3) — webhook org-resolution", () => {
	test("one installation maps to exactly one org; a second claim no-ops", async () => {
		await seedUser("owner-a");
		await seedUser("owner-b");
		const orgA = await seedTeamOrg("claim-a", "owner-a");
		const orgB = await seedTeamOrg("claim-b", "owner-b");
		const first = await linkOrgInstallation(db, {
			orgId: orgA,
			installationId: "inst-1",
		});
		const second = await linkOrgInstallation(db, {
			orgId: orgB,
			installationId: "inst-1",
		});
		expect(first.claimed).toBe(true);
		expect(second.claimed).toBe(false);
		expect(await getInstallationOrg(db, { installationId: "inst-1" })).toBe(
			orgA,
		);
	});

	test("repo sync resolves installation→org→repos with zero user assumptions", async () => {
		await seedUser("owner-c");
		const orgId = await seedTeamOrg("resolve-c", "owner-c");
		await linkOrgInstallation(db, { orgId, installationId: "inst-2" });
		// The worker path: resolve the claim, then sync carrying the org.
		const resolved = await getInstallationOrg(db, {
			installationId: "inst-2",
		});
		await syncInstallationRepos(
			db,
			"inst-2",
			[
				{
					externalId: "r-1",
					owner: "acme",
					name: "api",
					fullName: "acme/api",
					private: false,
				},
			],
			[],
			resolved,
		);
		const repoRows = await db
			.select({ orgId: repos.orgId })
			.from(repos)
			.where(eq(repos.fullName, "acme/api"));
		expect(repoRows[0]?.orgId).toBe(orgId);
	});

	test("unclaimed installs sync repos with NULL org — invisible, never auto-attached", async () => {
		await syncInstallationRepos(
			db,
			"inst-unclaimed",
			[
				{
					externalId: "r-2",
					owner: "stranger",
					name: "web",
					fullName: "stranger/web",
					private: true,
				},
			],
			[],
			await getInstallationOrg(db, { installationId: "inst-unclaimed" }),
		);
		const repoRows = await db
			.select({ orgId: repos.orgId })
			.from(repos)
			.where(eq(repos.fullName, "stranger/web"));
		expect(repoRows[0]?.orgId).toBeNull();
	});

	test("claiming later backfills org onto already-synced repos", async () => {
		await seedUser("late-claimer");
		const orgId = await seedTeamOrg("late-claim", "late-claimer");
		await linkOrgInstallation(db, {
			orgId,
			installationId: "inst-unclaimed",
		});
		const repoRows = await db
			.select({ orgId: repos.orgId })
			.from(repos)
			.where(eq(repos.fullName, "stranger/web"));
		expect(repoRows[0]?.orgId).toBe(orgId);
	});

	test("moveInstallation moves the claim AND the repos (history follows)", async () => {
		await seedUser("mover");
		const target = await seedTeamOrg("move-target", "mover");
		const { moved } = await moveInstallation(db, {
			installationId: "inst-2",
			toOrgId: target,
		});
		expect(moved).toBe(true);
		expect(await getInstallationOrg(db, { installationId: "inst-2" })).toBe(
			target,
		);
		const repoRows = await db
			.select({ orgId: repos.orgId })
			.from(repos)
			.where(eq(repos.fullName, "acme/api"));
		expect(repoRows[0]?.orgId).toBe(target);
	});
});

describe("deletion cascade (§5 + amendment 4)", () => {
	test("enumerate → delete: FK cascades fire, repos soft-remove, history intact", async () => {
		await seedUser("deleter", "approved");
		const orgId = await seedTeamOrg("doomed", "deleter");
		await createInviteLink(db, {
			orgId,
			role: "member",
			createdBy: "deleter",
		});
		await linkOrgInstallation(db, { orgId, installationId: "inst-doomed" });
		await syncInstallationRepos(
			db,
			"inst-doomed",
			[
				{
					externalId: "r-3",
					owner: "doomed",
					name: "repo",
					fullName: "doomed/repo",
					private: false,
				},
			],
			[],
			orgId,
		);
		const cascade = await enumerateOrgCascade(db, orgId);
		expect(cascade).toMatchObject({
			members: 1,
			inviteLinks: 1,
			installations: 1,
			repos: 1,
		});
		const { deleted } = await deleteOrganization(db, orgId);
		expect(deleted).toBe(true);
		expect(
			(
				await db
					.select()
					.from(organizationInstallations)
					.where(eq(organizationInstallations.organizationId, orgId))
			).length,
		).toBe(0);
		const repoRows = await db
			.select({ orgId: repos.orgId, removedAt: repos.removedAt })
			.from(repos)
			.where(eq(repos.fullName, "doomed/repo"));
		expect(repoRows[0]?.orgId).toBeNull();
		expect(repoRows[0]?.removedAt).not.toBeNull();
	});
});

describe("migration backfill (§11) — idempotency", () => {
	test("run twice ⇒ identical state; claimed-but-null verification holds", async () => {
		await seedUser("legacy-user");
		// A claimed installation whose repos predate the denormalized org_id.
		const legacyOrg = await ensurePersonalOrg(db, {
			userId: "legacy-user",
			name: "legacy-user",
		});
		await linkOrgInstallation(db, {
			orgId: legacyOrg.id,
			installationId: "inst-legacy",
		});
		await syncInstallationRepos(
			db,
			"inst-legacy",
			[
				{
					externalId: "r-legacy",
					owner: "legacy",
					name: "app",
					fullName: "legacy/app",
					private: false,
				},
			],
			[],
			null, // simulate a pre-org sync: no denormalized org pointer
		);

		const first = await backfillOrgs(db);
		expect(first.claimedButNullRepos).toBe(0);

		const orgsAfterFirst = await db.select().from(organization);
		const membersAfterFirst = await db.select().from(member);

		const second = await backfillOrgs(db);
		expect(second.claimedButNullRepos).toBe(0);
		expect((await db.select().from(organization)).length).toBe(
			orgsAfterFirst.length,
		);
		expect((await db.select().from(member)).length).toBe(
			membersAfterFirst.length,
		);

		// The fill routed the legacy repo to the claiming org.
		expect(
			await getInstallationOrg(db, { installationId: "inst-legacy" }),
		).toBe(legacyOrg.id);
		const repoRows = await db
			.select({ orgId: repos.orgId })
			.from(repos)
			.where(eq(repos.fullName, "legacy/app"));
		expect(repoRows[0]?.orgId).toBe(legacyOrg.id);
	});
});
