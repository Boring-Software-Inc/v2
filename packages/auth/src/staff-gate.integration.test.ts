import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	accessServices,
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	orgServices,
	schema,
	staffServices,
	type TestDatabase,
} from "@tripwire/db";
import { eq } from "drizzle-orm";
import { createAuth } from "./server.ts";
import { isPlatformAdmin } from "./staff-gate.ts";

/**
 * Platform staff role + the portal's mutation paths, against a REAL Postgres:
 *   - isPlatformAdmin cannot be set through client input (Better Auth
 *     `input: false` — the most privileged field in the system);
 *   - the staff gate denies non-staff and unknown users, admits granted ones,
 *     and revocation is instant (fresh read, no session claims);
 *   - approve/reject stamp accessReviewedAt/By with the acting admin;
 *   - bulk approve is idempotent (re-run changes nothing);
 *   - the staff role-change path trips the SAME last-admin + personal-org
 *     guards as the plugin hook (no bypass powers).
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let auth: ReturnType<typeof createAuth>;

const PASSWORD = "tripwire-dev-persona";

async function signUp(
	email: string,
	name: string,
	extraBody?: Record<string, unknown>,
): Promise<{ cookie: string; userId: string }> {
	const res = await auth.api.signUpEmail({
		body: { email, password: PASSWORD, name, ...extraBody } as never,
		asResponse: true,
	});
	expect(res.ok).toBe(true);
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	const session = await auth.api.getSession({
		headers: new Headers({ cookie }),
	});
	if (!session) {
		throw new Error("no session after signup");
	}
	return { cookie, userId: session.user.id };
}

async function grantStaff(userId: string): Promise<void> {
	await db
		.update(schema.user)
		.set({ isPlatformAdmin: true })
		.where(eq(schema.user.id, userId));
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	auth = createAuth({
		db,
		secret: "test-secret-please-ignore",
		baseUrl: "http://localhost:3000",
		github: null,
		devLogin: true,
	});
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("isPlatformAdmin is server-assigned only", () => {
	test("a signup payload carrying isPlatformAdmin lands as a non-staff row", async () => {
		const { userId } = await signUp("sneaky@example.com", "Sneaky", {
			isPlatformAdmin: true,
		});
		const rows = await db
			.select({ isPlatformAdmin: schema.user.isPlatformAdmin })
			.from(schema.user)
			.where(eq(schema.user.id, userId));
		expect(rows[0]?.isPlatformAdmin).toBe(false);
	});

	test("updateUser refuses the field outright (FIELD_NOT_ALLOWED)", async () => {
		const { cookie, userId } = await signUp("updater@example.com", "Updater");
		await expect(
			auth.api.updateUser({
				body: { isPlatformAdmin: true } as never,
				headers: new Headers({ cookie }),
			}),
		).rejects.toThrow("isPlatformAdmin is not allowed to be set");
		expect(await isPlatformAdmin(db, userId)).toBe(false);
	});
});

describe("staff gate (fresh read, deny by default)", () => {
	test("non-staff and unknown users are denied; a grant admits; revocation is instant", async () => {
		const { userId } = await signUp("regular@example.com", "Regular");
		expect(await isPlatformAdmin(db, userId)).toBe(false);
		expect(await isPlatformAdmin(db, "no-such-user")).toBe(false);

		await grantStaff(userId);
		expect(await isPlatformAdmin(db, userId)).toBe(true);

		await db
			.update(schema.user)
			.set({ isPlatformAdmin: false })
			.where(eq(schema.user.id, userId));
		expect(await isPlatformAdmin(db, userId)).toBe(false);
	});

	test("org-admin grants nothing at the platform level", async () => {
		const { cookie, userId } = await signUp("orgadmin@example.com", "OrgAdmin");
		await auth.api.createOrganization({
			body: { name: "Their Team", slug: "their-team" },
			headers: new Headers({ cookie }),
		});
		expect(await isPlatformAdmin(db, userId)).toBe(false);
	});
});

describe("access review through the existing paths", () => {
	test("approve stamps accessReviewedAt/By with the acting admin", async () => {
		const { userId: staffId } = await signUp("staff@example.com", "Staff");
		await grantStaff(staffId);
		const { userId } = await signUp("applicant@example.com", "Applicant");

		const { promoted } = await accessServices.promoteUserAccess(db, {
			userId,
			reviewedBy: staffId,
		});
		expect(promoted).toBe(true);
		const rows = await db
			.select({
				accessStatus: schema.user.accessStatus,
				accessReviewedAt: schema.user.accessReviewedAt,
				accessReviewedBy: schema.user.accessReviewedBy,
			})
			.from(schema.user)
			.where(eq(schema.user.id, userId));
		expect(rows[0]?.accessStatus).toBe("approved");
		expect(rows[0]?.accessReviewedBy).toBe(staffId);
		expect(rows[0]?.accessReviewedAt).toBeInstanceOf(Date);
	});

	test("bulk approve is idempotent — the second run changes nothing", async () => {
		const a = await signUp("bulk-a@example.com", "Bulk A");
		const b = await signUp("bulk-b@example.com", "Bulk B");
		const ids = [a.userId, b.userId];

		const first = await Promise.all(
			ids.map((userId) =>
				accessServices.promoteUserAccess(db, { userId, reviewedBy: "staff" }),
			),
		);
		expect(first.every((r) => r.promoted)).toBe(true);

		const second = await Promise.all(
			ids.map((userId) =>
				accessServices.promoteUserAccess(db, { userId, reviewedBy: "other" }),
			),
		);
		expect(second.every((r) => !r.promoted)).toBe(true);
		// The original reviewer survives the no-op re-run.
		const rows = await db
			.select({ reviewedBy: schema.user.accessReviewedBy })
			.from(schema.user)
			.where(eq(schema.user.id, a.userId));
		expect(rows[0]?.reviewedBy).toBe("staff");
	});

	test("reject stamps the audit fields and is idempotent; both directions work", async () => {
		const { userId } = await signUp("rejectee@example.com", "Rejectee");
		const { rejected } = await accessServices.rejectUserAccess(db, {
			userId,
			reviewedBy: "staff",
		});
		expect(rejected).toBe(true);
		const again = await accessServices.rejectUserAccess(db, {
			userId,
			reviewedBy: "staff",
		});
		expect(again.rejected).toBe(false);

		// rejected → approved is legal (promote's guard is ne "approved").
		const { promoted } = await accessServices.promoteUserAccess(db, {
			userId,
			reviewedBy: "staff",
		});
		expect(promoted).toBe(true);
		// approved → rejected is legal too (reject's guard is ne "rejected").
		const back = await accessServices.rejectUserAccess(db, {
			userId,
			reviewedBy: "staff",
		});
		expect(back.rejected).toBe(true);
	});
});

describe("staff role change shares the plugin's guard", () => {
	test("last-admin demotion refuses; a second admin unlocks it; personal orgs refuse", async () => {
		const { cookie, userId: adminId } = await signUp(
			"team-admin@example.com",
			"Team Admin",
		);
		const created = await auth.api.createOrganization({
			body: { name: "Guarded Team", slug: "guarded-team" },
			headers: new Headers({ cookie }),
		});
		const orgId = created?.id as string;

		const adminMember = await db
			.select({ id: schema.member.id, orgId: schema.member.organizationId })
			.from(schema.member)
			.where(eq(schema.member.userId, adminId));
		const adminMemberId = adminMember.find((m) => m.orgId === orgId)
			?.id as string;

		// Sole admin: the staff path must refuse the demotion.
		const refused = await orgServices.updateMemberRoleForStaff(db, {
			memberId: adminMemberId,
			role: "member",
		});
		expect(refused).toMatchObject({
			ok: false,
			error: "an org must keep at least one admin",
		});

		// Add a second admin; now the demotion goes through.
		const other = await signUp("second-admin@example.com", "Second Admin");
		await auth.api.addMember({
			body: { organizationId: orgId, userId: other.userId, role: "admin" },
		});
		const allowed = await orgServices.updateMemberRoleForStaff(db, {
			memberId: adminMemberId,
			role: "member",
		});
		expect(allowed).toEqual({ ok: true });

		// Personal orgs refuse role changes outright.
		const personal = await orgServices.listUserOrgs(db, other.userId);
		const personalOrg = personal.find((o) => o.isPersonal);
		const personalMember = await db
			.select({ id: schema.member.id })
			.from(schema.member)
			.where(eq(schema.member.organizationId, personalOrg?.id as string));
		const personalRefused = await orgServices.updateMemberRoleForStaff(db, {
			memberId: personalMember[0]?.id as string,
			role: "member",
		});
		expect(personalRefused).toMatchObject({
			ok: false,
			error: "cannot change roles in a personal org",
		});

		// Unknown member id is a soft error, not a throw.
		expect(
			await orgServices.updateMemberRoleForStaff(db, {
				memberId: "no-such-member",
				role: "member",
			}),
		).toMatchObject({ ok: false, error: "member not found" });
	});
});

describe("staff list queries", () => {
	test("lists paginate with clamped limits and report totals", async () => {
		const users = await staffServices.listUsersForStaff(db, { limit: 2 });
		expect(users.users.length).toBeLessThanOrEqual(2);
		expect(users.total).toBeGreaterThan(2);

		const orgs = await staffServices.listOrgsForStaff(db, { limit: 1 });
		expect(orgs.orgs.length).toBe(1);
		expect(orgs.total).toBeGreaterThan(1);

		const overview = await staffServices.getStaffOverview(db);
		expect(overview.orgs).toBe(orgs.total);
	});

	test("status filter and search narrow the users list", async () => {
		const rejected = await staffServices.listUsersForStaff(db, {
			status: "rejected",
		});
		expect(rejected.users.every((u) => u.accessStatus === "rejected")).toBe(
			true,
		);

		const search = await staffServices.listUsersForStaff(db, {
			search: "applicant",
		});
		expect(search.users.length).toBe(1);
		expect(search.users[0]?.email).toBe("applicant@example.com");
		expect(search.users[0]?.personalOrgSlug).toBe("applicant");
		expect(search.users[0]?.membershipCount).toBe(1);
	});
});
