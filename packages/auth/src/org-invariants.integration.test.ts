import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	orgServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { and, eq } from "drizzle-orm";
import { createAuth } from "./server.ts";

/**
 * §org-model invariants, proven against the REAL Better Auth instance (its
 * routes + our organizationHooks are the enforcement surface — a unit test of
 * the hook functions alone would miss the wiring):
 *   - signup auto-creates the personal org (single admin member);
 *   - personal orgs refuse member adds and role changes;
 *   - last-admin guard blocks demotion/removal/leave;
 *   - no self-kick at the fn layer is checkpoint-2 (server fns); the hook
 *     layer here is the data-level backstop;
 *   - the plugin's email-invitation path is hard-refused;
 *   - two roles only — creator lands as plain "admin", unknown roles refuse.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let auth: ReturnType<typeof createAuth>;

const PASSWORD = "tripwire-dev-persona";

function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

async function signUp(
	email: string,
	name: string,
): Promise<{ cookie: string; userId: string }> {
	const res = await auth.api.signUpEmail({
		body: { email, password: PASSWORD, name },
		asResponse: true,
	});
	expect(res.ok).toBe(true);
	const cookie = cookieHeader(res);
	const session = await auth.api.getSession({
		headers: new Headers({ cookie }),
	});
	if (!session) {
		throw new Error("no session after signup");
	}
	return { cookie, userId: session.user.id };
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

describe("signup → personal org (§1)", () => {
	test("a fresh signup owns a single-admin personal org", async () => {
		const { userId } = await signUp("solo@example.com", "Solo Dev");
		const orgs = await orgServices.listUserOrgs(db, userId);
		expect(orgs.length).toBe(1);
		expect(orgs[0]).toMatchObject({
			isPersonal: true,
			role: "admin",
			slug: "solo-dev",
		});
	});
});

describe("team orgs through the plugin", () => {
	test("creator lands as plain admin (no owner tier); slug line holds", async () => {
		const { cookie, userId } = await signUp("founder@example.com", "Founder");
		const created = await auth.api.createOrganization({
			body: { name: "Boring Team", slug: "boring-team" },
			headers: new Headers({ cookie }),
		});
		expect(created?.slug).toBe("boring-team");
		const role = await orgServices.getMemberRole(db, {
			orgId: created?.id as string,
			userId,
		});
		expect(role).toBe("admin");

		// Reserved slug refuses at the hook.
		await expect(
			auth.api.createOrganization({
				body: { name: "Sneaky", slug: "admin" },
				headers: new Headers({ cookie }),
			}),
		).rejects.toThrow();
	});

	test("email invitations are hard-refused (invite links are the only path)", async () => {
		const { cookie } = await signUp("no-email@example.com", "No Email");
		const org = await auth.api.createOrganization({
			body: { name: "No Email Org", slug: "no-email-org" },
			headers: new Headers({ cookie }),
		});
		expect(org).toBeTruthy();
		await expect(
			auth.api.createInvitation({
				body: {
					email: "someone@example.com",
					role: "member",
					organizationId: org?.id as string,
				},
				headers: new Headers({ cookie }),
			}),
		).rejects.toThrow(/invite links/);
	});
});

describe("last-admin guard + personal-org hooks (§5)", () => {
	test("personal orgs refuse member adds", async () => {
		const { userId } = await signUp("island@example.com", "Island");
		const { userId: other } = await signUp("visitor@example.com", "Visitor");
		const personal = (await orgServices.listUserOrgs(db, userId))[0];
		await expect(
			auth.api.addMember({
				body: {
					userId: other,
					organizationId: personal?.id as string,
					role: "member",
				},
			}),
		).rejects.toThrow(/personal orgs/);
	});

	test("the sole admin cannot be demoted or removed; leave is blocked", async () => {
		const { cookie, userId } = await signUp("last@example.com", "Last Admin");
		const org = await auth.api.createOrganization({
			body: { name: "Guarded", slug: "guarded" },
			headers: new Headers({ cookie }),
		});
		const orgId = org?.id as string;
		// A second, plain member so removal/demotion targets are unambiguous.
		const { userId: peon } = await signUp("peon@example.com", "Peon");
		await auth.api.addMember({
			body: { userId: peon, organizationId: orgId, role: "member" },
		});
		// Filter by org too — every signup also has a personal-org membership,
		// and the plugin (correctly) 403s a member id from another org.
		const adminMember = await db
			.select({ id: schema.member.id })
			.from(schema.member)
			.where(
				and(
					eq(schema.member.userId, userId),
					eq(schema.member.organizationId, orgId),
				),
			);
		const adminMemberId = adminMember[0]?.id as string;

		// The invariant, asserted through the REAL routes: no sequence of calls
		// may reach zero admins. Self-demotion is refused by the plugin's own
		// "not allowed to update this member"; self-REMOVAL reaches our
		// beforeRemoveMember hook, whose admin-count guard is load-bearing.
		await expect(
			auth.api.updateMemberRole({
				body: {
					memberId: adminMemberId,
					role: "member",
					organizationId: orgId,
				},
				headers: new Headers({ cookie }),
			}),
		).rejects.toThrow();

		await expect(
			auth.api.removeMember({
				body: { memberIdOrEmail: adminMemberId, organizationId: orgId },
				headers: new Headers({ cookie }),
			}),
		).rejects.toThrow();

		// Whatever the refusal message, the org still has its admin.
		expect(await orgServices.countAdmins(db, orgId)).toBe(1);

		// Leave as the only admin → refused (plugin's creatorRole guard).
		await expect(
			auth.api.leaveOrganization({
				body: { organizationId: orgId },
				headers: new Headers({ cookie }),
			}),
		).rejects.toThrow();

		// Promote the peon, then the original admin CAN leave.
		const peonMember = await db
			.select({ id: schema.member.id })
			.from(schema.member)
			.where(
				and(
					eq(schema.member.userId, peon),
					eq(schema.member.organizationId, orgId),
				),
			);
		await auth.api.updateMemberRole({
			body: {
				memberId: peonMember[0]?.id as string,
				role: "admin",
				organizationId: orgId,
			},
			headers: new Headers({ cookie }),
		});
		const left = await auth.api.leaveOrganization({
			body: { organizationId: orgId },
			headers: new Headers({ cookie }),
		});
		expect(left).toBeTruthy();
	});

	test("unknown roles refuse (two roles only)", async () => {
		const { cookie } = await signUp("roles@example.com", "Roles");
		const org = await auth.api.createOrganization({
			body: { name: "Two Roles", slug: "two-roles" },
			headers: new Headers({ cookie }),
		});
		const { userId: extra } = await signUp("extra@example.com", "Extra");
		await expect(
			auth.api.addMember({
				body: {
					userId: extra,
					organizationId: org?.id as string,
					role: "owner" as never,
				},
			}),
		).rejects.toThrow();
	});
});
