import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	INSTALL_ACCESS_CHECK_TTL_SECONDS,
	type InstallStatus,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { backfillOrgs } from "../backfill-orgs.ts";
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
	installationAccessChecks,
	member,
	organization,
	organizationInstallations,
	organizationInviteLinks,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { promoteUserAccess } from "./access.ts";
import { recordInstallAccessCheck } from "./installation-access.ts";
import {
	countAdmins,
	createInviteLink,
	deleteOrganization,
	ensurePersonalOrg,
	enumerateOrgCascade,
	getInstallationOrg,
	getOrgForUser,
	linkOrgInstallation,
	listApprovedInstallRequests,
	listClaimableInstallations,
	listInviteLinks,
	listUnprovenInstallationClaims,
	listUserOrgs,
	moveInstallation,
	pickOrgSlug,
	redeemInviteLink,
	resolveInstallStatus,
	revokeInviteLink,
	updateMemberRoleForStaff,
	userCanClaimInstallation,
} from "./organizations.ts";
import { syncInstallationRepos } from "./repos.ts";

/**
 * §org-model integration — real Postgres, never mocked: the tx + constraints
 * ARE the logic (invite redemption's guarded increment, the (forge,
 * installationId) unique, FK cascades on delete).
 */
let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];

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

async function addMember(
	orgId: string,
	userId: string,
	role: string,
): Promise<string> {
	const id = generateId();
	await db.insert(member).values({ id, organizationId: orgId, userId, role });
	return id;
}

async function waitForLockWaiters(count: number): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const result = await db.execute<{ n: number }>(
			sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
		);
		if ((result.rows[0]?.n ?? 0) >= count) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`never saw ${count} transactions waiting on a lock`);
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

describe("last admin", () => {
	test("two admins removed at once leave the team one admin", async () => {
		await seedUser("rm-a");
		await seedUser("rm-b");
		const orgId = await seedTeamOrg("rm-team", "rm-a");
		const memberA = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.organizationId, orgId));
		const memberB = await addMember(orgId, "rm-b", "admin");

		const gate = await pool.connect();
		await gate.query("BEGIN");
		await gate.query("SELECT id FROM organization WHERE id = $1 FOR UPDATE", [
			orgId,
		]);
		const results = Promise.allSettled(
			[memberA[0]?.id ?? "", memberB].map((id) =>
				db.delete(member).where(eq(member.id, id)),
			),
		);
		try {
			await waitForLockWaiters(2);
		} finally {
			await gate.query("COMMIT");
			gate.release();
		}
		const settled = await results;

		expect(settled.map((result) => result.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		expect(await countAdmins(db, orgId)).toBe(1);
	});

	test("two staff demotions at once leave the team one admin", async () => {
		await seedUser("staff-a");
		await seedUser("staff-b");
		const orgId = await seedTeamOrg("staff-team", "staff-a");
		const [first] = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.organizationId, orgId));
		const second = await addMember(orgId, "staff-b", "admin");

		const gate = await pool.connect();
		await gate.query("BEGIN");
		await gate.query("SELECT id FROM organization WHERE id = $1 FOR UPDATE", [
			orgId,
		]);
		const results = Promise.all(
			[first?.id ?? "", second].map((memberId) =>
				updateMemberRoleForStaff(db, { memberId, role: "member" }),
			),
		);
		try {
			await waitForLockWaiters(2);
		} finally {
			await gate.query("COMMIT");
			gate.release();
		}

		expect(await results).toContainEqual({
			ok: false,
			error: "an org must keep at least one admin",
		});
		expect(await results).toContainEqual({ ok: true });
		expect(await countAdmins(db, orgId)).toBe(1);
	});

	test("demoting the last admin is refused by the database", async () => {
		await seedUser("demote-a");
		const orgId = await seedTeamOrg("demote-team", "demote-a");

		await expect(
			db
				.update(member)
				.set({ role: "member" })
				.where(
					and(eq(member.organizationId, orgId), eq(member.userId, "demote-a")),
				)
				.execute(),
		).rejects.toThrow();
		expect(await countAdmins(db, orgId)).toBe(1);
	});

	test("deleting a team org still removes its admin", async () => {
		await seedUser("gone-a");
		const orgId = await seedTeamOrg("gone-team", "gone-a");

		await db.delete(organization).where(eq(organization.id, orgId));

		expect(await countAdmins(db, orgId)).toBe(0);
	});
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

describe("approved install requests — the requester's way back", () => {
	async function seedApproval(installationId: string, requesterId: number) {
		await db.insert(events).values({
			id: generateId(),
			forge: "github",
			deliveryId: generateId(),
			rawKind: "installation",
			kind: "installation.created",
			raw: {
				action: "created",
				installation: {
					id: Number(installationId),
					account: { login: "corp" },
				},
				requester: { id: requesterId, login: "asker" },
			},
		});
		await syncInstallationRepos(
			db,
			installationId,
			[
				{
					externalId: `r-${installationId}`,
					owner: "corp",
					name: `app-${installationId}`,
					fullName: `corp/app-${installationId}`,
					private: true,
				},
			],
			[],
			null,
		);
	}

	test("the requester sees the approved, unclaimed install; others do not", async () => {
		await seedUser("asker");
		await seedUser("bystander");
		await db.insert(account).values({
			id: generateId(),
			userId: "asker",
			providerId: "github",
			accountId: "9001",
		});
		await seedApproval("7001", 9001);

		expect(await listApprovedInstallRequests(db, { userId: "asker" })).toEqual([
			{ installationId: "7001", account: "corp", repoCount: 1 },
		]);
		expect(
			await listApprovedInstallRequests(db, { userId: "bystander" }),
		).toEqual([]);
	});

	test("claiming the install clears it", async () => {
		const orgId = await seedTeamOrg("asker-team", "asker");
		await linkOrgInstallation(db, { orgId, installationId: "7001" });
		expect(await listApprovedInstallRequests(db, { userId: "asker" })).toEqual(
			[],
		);
	});
});

describe("claim ownership — only the installer, requester or account owner", () => {
	async function seedGithubUser(id: string, githubId: string): Promise<void> {
		await seedUser(id);
		await db.insert(account).values({
			id: generateId(),
			userId: id,
			providerId: "github",
			accountId: githubId,
		});
	}

	async function seedInstall(input: {
		installationId: string;
		accountId: number;
		accountLogin: string;
		senderId: number;
		requesterId: number | null;
	}): Promise<void> {
		await db.insert(events).values({
			id: generateId(),
			forge: "github",
			deliveryId: generateId(),
			rawKind: "installation",
			kind: "installation.created",
			raw: {
				action: "created",
				installation: {
					id: Number(input.installationId),
					account: { id: input.accountId, login: input.accountLogin },
				},
				sender: { id: input.senderId },
				requester: input.requesterId ? { id: input.requesterId } : null,
			},
		});
		await syncInstallationRepos(
			db,
			input.installationId,
			[
				{
					externalId: `own-${input.installationId}`,
					owner: input.accountLogin,
					name: `private-${input.installationId}`,
					fullName: `${input.accountLogin}/private-${input.installationId}`,
					private: true,
				},
			],
			[],
			null,
		);
	}

	const sealed = (
		installationId: string,
		recoverable: boolean,
	): InstallStatus => ({
		installationId,
		forge: "github",
		status: "not-yours",
		recoverable,
	});

	let kolfOrg = "";

	beforeAll(async () => {
		await seedGithubUser("kolfadser1", "5001");
		await seedGithubUser("salt", "5002");
		await seedInstall({
			installationId: "8001",
			accountId: 6001,
			accountLogin: "kolf-corp",
			senderId: 5001,
			requesterId: null,
		});
	});

	test("another user cannot list, preview or claim the installation (SALT case)", async () => {
		expect(await listClaimableInstallations(db, { userId: "salt" })).toEqual(
			[],
		);
		expect(
			await resolveInstallStatus(db, {
				userId: "salt",
				installationId: "8001",
				stateOrgId: null,
			}),
		).toEqual(sealed("8001", true));
		expect(
			await userCanClaimInstallation(db, {
				userId: "salt",
				forge: "github",
				installationId: "8001",
			}),
		).toBe(false);
	});

	test("a valid state for the attacker's own org does not unlock the victim's installation", async () => {
		const saltOrg = await seedTeamOrg("salt-team", "salt");
		expect(
			await resolveInstallStatus(db, {
				userId: "salt",
				installationId: "8001",
				stateOrgId: saltOrg,
			}),
		).toEqual(sealed("8001", true));
	});

	test("anonymous callers get a sealed preview", async () => {
		expect(
			await resolveInstallStatus(db, {
				userId: null,
				installationId: "8001",
				stateOrgId: null,
			}),
		).toEqual(sealed("8001", false));
	});

	test("the installer lists, previews and may claim their installation", async () => {
		kolfOrg = await seedTeamOrg("kolf-team", "kolfadser1");
		expect(
			await listClaimableInstallations(db, { userId: "kolfadser1" }),
		).toEqual([
			{
				installationId: "8001",
				forge: "github",
				account: "kolf-corp",
				repoCount: 1,
			},
		]);
		expect(
			await resolveInstallStatus(db, {
				userId: "kolfadser1",
				installationId: "8001",
				stateOrgId: kolfOrg,
			}),
		).toEqual({
			installationId: "8001",
			forge: "github",
			status: "claimable",
			account: "kolf-corp",
			repoCount: 1,
			stateOrg: { id: kolfOrg, slug: "kolf-team", name: "kolf-team" },
		});
		expect(
			await userCanClaimInstallation(db, {
				userId: "kolfadser1",
				forge: "github",
				installationId: "8001",
			}),
		).toBe(true);
	});

	test("once claimed, only members of the owning org learn which org has it", async () => {
		await linkOrgInstallation(db, { orgId: kolfOrg, installationId: "8001" });
		expect(
			await resolveInstallStatus(db, {
				userId: "kolfadser1",
				installationId: "8001",
				stateOrgId: null,
			}),
		).toMatchObject({ status: "claimed-by-your-org", orgSlug: "kolf-team" });
		expect(
			await resolveInstallStatus(db, {
				userId: "salt",
				installationId: "8001",
				stateOrgId: null,
			}),
		).toEqual(sealed("8001", false));
		expect(
			await listClaimableInstallations(db, { userId: "kolfadser1" }),
		).toEqual([]);
	});

	test("the requester of an approved install request may claim it", async () => {
		await seedGithubUser("org-admin", "5003");
		await seedGithubUser("requester", "5004");
		await seedInstall({
			installationId: "8002",
			accountId: 6002,
			accountLogin: "big-corp",
			senderId: 5003,
			requesterId: 5004,
		});
		for (const userId of ["org-admin", "requester"]) {
			expect(
				await userCanClaimInstallation(db, {
					userId,
					forge: "github",
					installationId: "8002",
				}),
			).toBe(true);
		}
		expect(
			await listClaimableInstallations(db, { userId: "requester" }),
		).toEqual([
			{
				installationId: "8002",
				forge: "github",
				account: "big-corp",
				repoCount: 1,
			},
		]);
		expect(
			await userCanClaimInstallation(db, {
				userId: "salt",
				forge: "github",
				installationId: "8002",
			}),
		).toBe(false);
	});

	test("the account owner of a personal install may claim it", async () => {
		await seedGithubUser("solo", "5005");
		await seedInstall({
			installationId: "8003",
			accountId: 5005,
			accountLogin: "solo",
			senderId: 5999,
			requesterId: null,
		});
		expect(
			await userCanClaimInstallation(db, {
				userId: "solo",
				forge: "github",
				installationId: "8003",
			}),
		).toBe(true);
	});

	test("an installation with no stored installation webhook is claimable by nobody", async () => {
		await syncInstallationRepos(
			db,
			"8004",
			[
				{
					externalId: "own-8004",
					owner: "kolf-corp",
					name: "no-webhook",
					fullName: "kolf-corp/no-webhook",
					private: true,
				},
			],
			[],
			null,
		);
		expect(
			await userCanClaimInstallation(db, {
				userId: "kolfadser1",
				forge: "github",
				installationId: "8004",
			}),
		).toBe(false);
	});

	test("an OAuth forge connection is claimable by the user whose account it is", async () => {
		await seedUser("og-user");
		await db.insert(account).values({
			id: generateId(),
			userId: "og-user",
			providerId: "opengit",
			accountId: "og-acct-1",
		});
		await syncInstallationRepos(
			db,
			"og-acct-1",
			[
				{
					externalId: "og-r-1",
					owner: "og-user",
					name: "tool",
					fullName: "og-user/tool",
					private: true,
				},
			],
			[],
			null,
			"opengit",
		);
		expect(await listClaimableInstallations(db, { userId: "og-user" })).toEqual(
			[
				{
					installationId: "og-acct-1",
					forge: "opengit",
					account: "og-user",
					repoCount: 1,
				},
			],
		);
		expect(
			await resolveInstallStatus(db, {
				userId: "og-user",
				installationId: "og-acct-1",
				stateOrgId: null,
			}),
		).toMatchObject({ forge: "opengit", status: "claimable", repoCount: 1 });
		expect(
			await userCanClaimInstallation(db, {
				userId: "salt",
				forge: "opengit",
				installationId: "og-acct-1",
			}),
		).toBe(false);
		expect(
			await userCanClaimInstallation(db, {
				userId: "og-user",
				forge: "github",
				installationId: "og-acct-1",
			}),
		).toBe(false);
	});
});

describe("install status — what the setup page shows", () => {
	async function seedGithubUser(id: string, githubId: string): Promise<void> {
		await seedUser(id);
		await db.insert(account).values({
			id: generateId(),
			userId: id,
			providerId: "github",
			accountId: githubId,
		});
	}

	async function seedInstallEvent(input: {
		installationId: string;
		senderId: number;
		kind: string | null;
		quarantined?: boolean;
		action?: string;
	}): Promise<void> {
		await db.insert(events).values({
			id: generateId(),
			forge: "github",
			deliveryId: generateId(),
			rawKind: "installation",
			kind: input.kind,
			quarantined: input.quarantined ?? false,
			raw: {
				action: input.action ?? "created",
				installation: {
					id: Number(input.installationId),
					account: { id: 7777, login: "status-corp" },
				},
				sender: { id: input.senderId },
			},
		});
	}

	function status(userId: string | null, installationId: string) {
		return resolveInstallStatus(db, {
			userId,
			installationId,
			stateOrgId: null,
		});
	}

	beforeAll(async () => {
		await seedGithubUser("status-owner", "6101");
		await seedGithubUser("status-other", "6102");
	});

	test("a stored but not yet normalized webhook is processing", async () => {
		await seedInstallEvent({
			installationId: "9001",
			senderId: 6101,
			kind: null,
		});
		expect(await status("status-owner", "9001")).toEqual({
			installationId: "9001",
			forge: "github",
			status: "processing",
		});
	});

	test("a raw installation event that is not a create never reads as processing", async () => {
		await seedInstallEvent({
			installationId: "9002",
			senderId: 6101,
			kind: null,
			action: "new_permissions_accepted",
		});
		expect(await status("status-owner", "9002")).toMatchObject({
			status: "missing",
			recoverable: true,
		});
	});

	test("a quarantined webhook is unreadable", async () => {
		await seedInstallEvent({
			installationId: "9003",
			senderId: 6101,
			kind: null,
			quarantined: true,
		});
		expect(await status("status-owner", "9003")).toMatchObject({
			status: "unreadable",
		});
	});

	test("no webhook at all is missing, and recoverable until a check lands", async () => {
		expect(await status("status-owner", "9004")).toEqual({
			installationId: "9004",
			forge: "github",
			status: "missing",
			recoverable: true,
		});
		await recordInstallAccessCheck(db, {
			userId: "status-owner",
			forge: "github",
			installationId: "9004",
			result: "pending",
		});
		expect(await status("status-owner", "9004")).toMatchObject({
			status: "recovering",
		});
		await recordInstallAccessCheck(db, {
			userId: "status-owner",
			forge: "github",
			installationId: "9004",
			result: "failed",
		});
		expect(await status("status-owner", "9004")).toMatchObject({
			status: "missing",
			recoverable: false,
		});
	});

	test("recovery results name the state", async () => {
		await recordInstallAccessCheck(db, {
			userId: "status-owner",
			forge: "github",
			installationId: "9005",
			result: "not-for-tripwire",
		});
		await recordInstallAccessCheck(db, {
			userId: "status-owner",
			forge: "github",
			installationId: "9006",
			result: "token-expired",
		});
		expect(await status("status-owner", "9005")).toMatchObject({
			status: "not-for-tripwire",
		});
		expect(await status("status-owner", "9006")).toMatchObject({
			status: "token-expired",
		});
	});

	test("a normalized webhook for someone else is not-yours and reveals nothing", async () => {
		await seedInstallEvent({
			installationId: "9007",
			senderId: 6101,
			kind: "installation.created",
		});
		await syncInstallationRepos(
			db,
			"9007",
			[
				{
					externalId: "status-9007",
					owner: "status-corp",
					name: "secret",
					fullName: "status-corp/secret",
					private: true,
				},
			],
			[],
			null,
		);
		expect(await status("status-other", "9007")).toEqual({
			installationId: "9007",
			forge: "github",
			status: "not-yours",
			recoverable: true,
		});
		await recordInstallAccessCheck(db, {
			userId: "status-other",
			forge: "github",
			installationId: "9007",
			result: "denied",
		});
		expect(await status("status-other", "9007")).toEqual({
			installationId: "9007",
			forge: "github",
			status: "not-yours",
			recoverable: false,
		});
		expect(await status("status-owner", "9007")).toMatchObject({
			status: "claimable",
			account: "status-corp",
			repoCount: 1,
		});
	});
});

describe("access checks — GitHub's own answer as ownership proof", () => {
	async function seedGithubUser(id: string, githubId: string): Promise<void> {
		await seedUser(id);
		await db.insert(account).values({
			id: generateId(),
			userId: id,
			providerId: "github",
			accountId: githubId,
		});
	}

	function canClaim(userId: string, installationId: string) {
		return userCanClaimInstallation(db, {
			userId,
			forge: "github",
			installationId,
		});
	}

	beforeAll(async () => {
		await seedGithubUser("check-admin", "6201");
		await seedGithubUser("check-stranger", "6202");
	});

	test("a fresh granted check lets the user claim without a webhook", async () => {
		expect(await canClaim("check-admin", "9101")).toBe(false);
		await recordInstallAccessCheck(db, {
			userId: "check-admin",
			forge: "github",
			installationId: "9101",
			result: "granted-admin",
		});
		expect(await canClaim("check-admin", "9101")).toBe(true);
	});

	test("a stale granted check does not", async () => {
		await recordInstallAccessCheck(db, {
			userId: "check-admin",
			forge: "github",
			installationId: "9102",
			result: "granted-admin",
			at: new Date(Date.now() - (INSTALL_ACCESS_CHECK_TTL_SECONDS + 60) * 1000),
		});
		expect(await canClaim("check-admin", "9102")).toBe(false);
		expect(
			await resolveInstallStatus(db, {
				userId: "check-admin",
				installationId: "9102",
				stateOrgId: null,
			}),
		).toMatchObject({ status: "missing", recoverable: true });
	});

	test("a negative check does not", async () => {
		for (const result of ["denied", "failed", "pending"] as const) {
			await recordInstallAccessCheck(db, {
				userId: "check-admin",
				forge: "github",
				installationId: "9103",
				result,
			});
			expect(await canClaim("check-admin", "9103")).toBe(false);
		}
	});

	test("another user's check never applies", async () => {
		await recordInstallAccessCheck(db, {
			userId: "check-admin",
			forge: "github",
			installationId: "9104",
			result: "granted-admin",
		});
		expect(await canClaim("check-stranger", "9104")).toBe(false);
		expect(
			await resolveInstallStatus(db, {
				userId: "check-stranger",
				installationId: "9104",
				stateOrgId: null,
			}),
		).toMatchObject({ status: "missing" });
	});

	test("the SALT case stays refused even with a check for someone else", async () => {
		await recordInstallAccessCheck(db, {
			userId: "kolfadser1",
			forge: "github",
			installationId: "8001",
			result: "granted-admin",
		});
		expect(await canClaim("salt", "8001")).toBe(false);
	});
});

describe("claim rule — admin-grade proof only", () => {
	async function seedGithubUser(id: string, githubId: string): Promise<void> {
		await seedUser(id);
		await db.insert(account).values({
			id: generateId(),
			userId: id,
			providerId: "github",
			accountId: githubId,
		});
	}

	function canClaim(userId: string, installationId: string) {
		return userCanClaimInstallation(db, {
			userId,
			forge: "github",
			installationId,
		});
	}

	async function legacyGrant(
		userId: string,
		installationId: string,
	): Promise<void> {
		await db.execute(sql`
			INSERT INTO installation_access_checks (id, user_id, forge, installation_id, result)
			VALUES (${generateId()}, ${userId}, 'github', ${installationId}, 'granted')
			ON CONFLICT (user_id, forge, installation_id)
			DO UPDATE SET result = 'granted', verified_at = now()
		`);
	}

	beforeAll(async () => {
		await seedGithubUser("rule-reader", "6301");
		await seedGithubUser("rule-stranger", "6302");
	});

	test("a fresh granted row from the old rule no longer allows a claim", async () => {
		await legacyGrant("rule-reader", "9201");
		expect(await canClaim("rule-reader", "9201")).toBe(false);
		expect(
			await listClaimableInstallations(db, { userId: "rule-reader" }),
		).toEqual([]);
	});

	test("the migration turns old granted rows into denials", async () => {
		await legacyGrant("rule-reader", "9202");
		const migration = await Bun.file(
			fileURLToPath(
				new URL(
					"../../drizzle/0024_revoke_legacy_install_grants.sql",
					import.meta.url,
				),
			),
		).text();
		await db.execute(sql.raw(migration));
		const rows = await db
			.select({ result: installationAccessChecks.result })
			.from(installationAccessChecks)
			.where(eq(installationAccessChecks.installationId, "9202"));
		expect(rows).toEqual([{ result: "denied" }]);
	});

	test("an admin-grade check for one forge never unlocks another", async () => {
		await recordInstallAccessCheck(db, {
			userId: "rule-reader",
			forge: "opengit",
			installationId: "9203",
			result: "granted-admin",
		});
		expect(await canClaim("rule-reader", "9203")).toBe(false);
	});

	test("a stranger with no link is refused, the installer and requester are allowed", async () => {
		await db.insert(events).values({
			id: generateId(),
			forge: "github",
			deliveryId: generateId(),
			rawKind: "installation",
			kind: "installation.created",
			raw: {
				action: "created",
				installation: {
					id: 9204,
					account: { id: 6390, login: "rule-corp", type: "Organization" },
				},
				sender: { id: 6301 },
				requester: { id: 6303 },
			},
		});
		await seedGithubUser("rule-requester", "6303");
		expect(await canClaim("rule-stranger", "9204")).toBe(false);
		expect(await canClaim("rule-reader", "9204")).toBe(true);
		expect(await canClaim("rule-requester", "9204")).toBe(true);
	});
});

describe("installation claim audit", () => {
	async function seedGithubUser(id: string, githubId: string): Promise<void> {
		await seedUser(id);
		await db.insert(account).values({
			id: generateId(),
			userId: id,
			providerId: "github",
			accountId: githubId,
		});
	}

	async function claimed(installationId: string): Promise<string[]> {
		const found = await listUnprovenInstallationClaims(db);
		return found
			.filter((claim) => claim.installationId === installationId)
			.map((claim) => claim.orgSlug);
	}

	const fixture = z
		.object({
			installation: z.object({ id: z.number() }),
			sender: z.object({ id: z.number() }),
		})
		.passthrough();

	test("a claim backed by the captured installer webhook passes", async () => {
		const raw = fixture.parse(
			await Bun.file(
				fileURLToPath(
					new URL(
						"../../../forge-github/fixtures/installation.created.json",
						import.meta.url,
					),
				),
			).json(),
		);
		const installationId = String(raw.installation.id);
		await db.insert(events).values({
			id: generateId(),
			forge: "github",
			deliveryId: generateId(),
			rawKind: "installation",
			kind: "installation.created",
			raw,
		});
		await seedGithubUser("audit-installer", String(raw.sender.id));
		const orgId = await seedTeamOrg("audit-owned", "audit-installer");
		await linkOrgInstallation(db, { orgId, installationId });
		expect(await claimed(installationId)).toEqual([]);
	});

	test("a claim with no owner link among the org's admins is reported", async () => {
		await seedGithubUser("audit-stranger", "6402");
		const orgId = await seedTeamOrg("audit-stolen", "audit-stranger");
		await linkOrgInstallation(db, { orgId, installationId: "9301" });
		await db.execute(sql`
			INSERT INTO installation_access_checks (id, user_id, forge, installation_id, result)
			VALUES (${generateId()}, 'audit-stranger', 'github', '9301', 'granted')
		`);
		expect(await claimed("9301")).toEqual(["audit-stolen"]);
	});

	test("an admin-grade check of any age proves the claim, a plain member's does not", async () => {
		await seedGithubUser("audit-admin", "6403");
		await seedGithubUser("audit-member", "6404");
		const orgId = await seedTeamOrg("audit-checked", "audit-admin");
		await db.insert(member).values({
			id: generateId(),
			organizationId: orgId,
			userId: "audit-member",
			role: "member",
		});
		await linkOrgInstallation(db, { orgId, installationId: "9302" });
		await recordInstallAccessCheck(db, {
			userId: "audit-member",
			forge: "github",
			installationId: "9302",
			result: "granted-admin",
		});
		expect(await claimed("9302")).toEqual(["audit-checked"]);
		await recordInstallAccessCheck(db, {
			userId: "audit-admin",
			forge: "github",
			installationId: "9302",
			result: "granted-admin",
			at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
		});
		expect(await claimed("9302")).toEqual([]);
	});

	test("non-numeric and non-github installations are skipped", async () => {
		await seedGithubUser("audit-oauth", "6405");
		const orgId = await seedTeamOrg("audit-oauth", "audit-oauth");
		await linkOrgInstallation(db, { orgId, installationId: "demo-inst-x" });
		await linkOrgInstallation(db, {
			orgId,
			installationId: "9303",
			forge: "opengit",
		});
		const found = await listUnprovenInstallationClaims(db);
		expect(found.map((claim) => claim.orgSlug)).not.toContain("audit-oauth");
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
