import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	ORG_PERMISSIONS,
	type OrgPermission,
	scopesToStatements,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	ensureDemoRepo,
	orgServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { and, eq } from "drizzle-orm";
import { reposWithPermission, resolveOrgAccess } from "./org-gate.ts";
import { createAuth } from "./server.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let auth: ReturnType<typeof createAuth>;

const PASSWORD = "tripwire-dev-persona";
const BASE = "http://localhost:3000";

function must<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) {
		throw new Error("expected a value");
	}
	return value;
}

function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

async function signUp(email: string, name: string) {
	const res = await auth.api.signUpEmail({
		body: { email, password: PASSWORD, name },
		asResponse: true,
	});
	expect(res.ok).toBe(true);
	const cookie = cookieHeader(res);
	const session = must(
		await auth.api.getSession({ headers: new Headers({ cookie }) }),
	);
	return { cookie, userId: session.user.id, headers: new Headers({ cookie }) };
}

async function memberId(orgId: string, userId: string): Promise<string> {
	const rows = await db
		.select({ id: schema.member.id })
		.from(schema.member)
		.where(
			and(
				eq(schema.member.userId, userId),
				eq(schema.member.organizationId, orgId),
			),
		);
	return must(rows[0]).id;
}

async function rawPost(path: string, cookie: string, body: string) {
	return await auth.handler(
		new Request(`${BASE}/api/auth${path}`, {
			method: "POST",
			headers: {
				cookie,
				"content-type": "application/json",
				origin: BASE,
			},
			body,
		}),
	);
}

let admin: Awaited<ReturnType<typeof signUp>>;
let moderator: Awaited<ReturnType<typeof signUp>>;
let reader: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
const ORG_SLUG = "roles-team";

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	auth = createAuth({
		db,
		secret: "test-secret-please-ignore",
		baseUrl: BASE,
		github: null,
		opengit: null,
		devLogin: true,
	});
	admin = await signUp("roles-admin@example.com", "Roles Admin");
	moderator = await signUp("roles-mod@example.com", "Roles Mod");
	reader = await signUp("roles-reader@example.com", "Roles Reader");
	const org = must(
		await auth.api.createOrganization({
			body: { name: "Roles Team", slug: ORG_SLUG },
			headers: admin.headers,
		}),
	);
	orgId = org.id;
	for (const user of [moderator, reader]) {
		await auth.api.addMember({
			body: { userId: user.userId, organizationId: orgId, role: "member" },
		});
	}
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function permissionsOf(userId: string): Promise<OrgPermission[]> {
	const result = await resolveOrgAccess(db, {
		userId,
		orgSlug: ORG_SLUG,
		requirement: { kind: "membership" },
	});
	if (!result.ok) {
		throw new Error(result.denial.message);
	}
	return result.org.permissions;
}

describe("a moderator role with only human review access", () => {
	test("an admin creates it through the plugin", async () => {
		const created = await auth.api.createOrgRole({
			body: {
				organizationId: orgId,
				role: "moderator",
				permission: scopesToStatements({ moderation: "manage" }),
			},
			headers: admin.headers,
		});
		expect(created.success).toBe(true);
		const rows = await orgServices.listOrgRoles(db, orgId);
		expect(rows.map((row) => row.role)).toEqual(["moderator"]);
	});

	test("an admin assigns it to a member", async () => {
		await auth.api.updateMemberRole({
			body: {
				memberId: await memberId(orgId, moderator.userId),
				role: "moderator",
				organizationId: orgId,
			},
			headers: admin.headers,
		});
		expect(
			await orgServices.getMemberRole(db, { orgId, userId: moderator.userId }),
		).toBe("moderator");
	});

	test("the gate grants human review and denies every other permission", async () => {
		expect(await permissionsOf(moderator.userId)).toEqual([
			"moderation:read",
			"moderation:manage",
		]);
		for (const permission of ORG_PERMISSIONS) {
			const result = await resolveOrgAccess(db, {
				userId: moderator.userId,
				orgSlug: ORG_SLUG,
				requirement: { kind: "permission", permission },
			});
			expect(result.ok).toBe(permission.startsWith("moderation:"));
		}
	});

	test("built-in role gates (used by the MCP server) refuse the moderator", async () => {
		for (const need of ["member", "admin"] as const) {
			const result = await resolveOrgAccess(db, {
				userId: moderator.userId,
				orgSlug: ORG_SLUG,
				requirement: { kind: "role", need },
			});
			expect(result.ok).toBe(false);
		}
	});

	test("a plain member still reads everything and manages nothing", async () => {
		expect(await permissionsOf(reader.userId)).toEqual(
			ORG_PERMISSIONS.filter((p) => p.endsWith(":read")),
		);
	});

	test("the live activity stream skips repos the role cannot read", async () => {
		await ensureDemoRepo(db, "roles-api", { installationId: "roles-inst" });
		await orgServices.linkOrgInstallation(db, {
			orgId,
			installationId: "roles-inst",
		});
		const read = await reposWithPermission(db, reader.userId, "activity:read");
		expect(read.filter((name) => name.endsWith("/roles-api"))).toHaveLength(1);
		expect(
			await reposWithPermission(db, moderator.userId, "activity:read"),
		).toEqual([]);
		expect(
			await reposWithPermission(db, moderator.userId, "moderation:read"),
		).toEqual(read);
	});

	test("a non-member gets not found", async () => {
		const outsider = await signUp("roles-out@example.com", "Outsider");
		const result = await resolveOrgAccess(db, {
			userId: outsider.userId,
			orgSlug: ORG_SLUG,
			requirement: { kind: "membership" },
		});
		expect(result.ok ? null : result.denial.code).toBe("NOT_FOUND");
	});
});

describe("no path lets a role escalate", () => {
	test("the moderator cannot create, change or delete roles", async () => {
		await expect(
			auth.api.createOrgRole({
				body: {
					organizationId: orgId,
					role: "helper",
					permission: { moderation: ["read"] },
				},
				headers: moderator.headers,
			}),
		).rejects.toThrow();
		await expect(
			auth.api.updateOrgRole({
				body: {
					organizationId: orgId,
					roleName: "moderator",
					data: { permission: { rules: ["read", "manage"] } },
				},
				headers: moderator.headers,
			}),
		).rejects.toThrow();
		await expect(
			auth.api.deleteOrgRole({
				body: { organizationId: orgId, roleName: "moderator" },
				headers: moderator.headers,
			}),
		).rejects.toThrow();
	});

	test("the moderator cannot change any member's role, including its own", async () => {
		for (const target of [moderator, reader, admin]) {
			await expect(
				auth.api.updateMemberRole({
					body: {
						memberId: await memberId(orgId, target.userId),
						role: "admin",
						organizationId: orgId,
					},
					headers: moderator.headers,
				}),
			).rejects.toThrow();
		}
		expect(await permissionsOf(moderator.userId)).toEqual([
			"moderation:read",
			"moderation:manage",
		]);
	});

	test("the moderator cannot remove members or edit the org", async () => {
		await expect(
			auth.api.removeMember({
				body: {
					memberIdOrEmail: await memberId(orgId, reader.userId),
					organizationId: orgId,
				},
				headers: moderator.headers,
			}),
		).rejects.toThrow();
		await expect(
			auth.api.updateOrganization({
				body: { organizationId: orgId, data: { name: "Taken" } },
				headers: moderator.headers,
			}),
		).rejects.toThrow();
	});

	test("even an admin cannot mint a role holding plugin or governance powers", async () => {
		const refused = [
			{ ac: ["create"] },
			{ member: ["update"] },
			{ organization: ["update"] },
			{ members: ["read", "manage"] },
			{ settings: ["manage"] },
			{ moderation: ["delete"] },
			{},
		];
		for (const permission of refused) {
			const res = await rawPost(
				"/organization/create-role",
				admin.cookie,
				JSON.stringify({
					organizationId: orgId,
					role: "sneaky",
					permission,
				}),
			);
			expect(res.status).toBe(400);
		}
		const rows = await orgServices.listOrgRoles(db, orgId);
		expect(rows.map((row) => row.role)).toEqual(["moderator"]);
	});

	test("reserved and malformed role names are refused", async () => {
		for (const role of ["admin", "member", "owner", "Mod Squad", "x", ""]) {
			const res = await rawPost(
				"/organization/create-role",
				admin.cookie,
				JSON.stringify({
					organizationId: orgId,
					role,
					permission: { moderation: ["read"] },
				}),
			);
			expect(res.status).toBe(400);
		}
	});

	test("a role update cannot rename the role or widen into plugin powers", async () => {
		const rename = await rawPost(
			"/organization/update-role",
			admin.cookie,
			JSON.stringify({
				organizationId: orgId,
				roleName: "moderator",
				data: { roleName: "admin2", permission: { moderation: ["read"] } },
			}),
		);
		expect(rename.status).toBe(400);
		const widen = await rawPost(
			"/organization/update-role",
			admin.cookie,
			JSON.stringify({
				organizationId: orgId,
				roleName: "moderator",
				data: { permission: { member: ["update"] } },
			}),
		);
		expect(widen.status).toBe(400);
		expect(await permissionsOf(moderator.userId)).toEqual([
			"moderation:read",
			"moderation:manage",
		]);
	});

	test("a role still held by a member cannot be deleted", async () => {
		await expect(
			auth.api.deleteOrgRole({
				body: { organizationId: orgId, roleName: "moderator" },
				headers: admin.headers,
			}),
		).rejects.toThrow();
	});

	test("an unknown or multi-role assignment is refused", async () => {
		for (const role of ["ghost", "moderator,admin"]) {
			await expect(
				auth.api.updateMemberRole({
					body: {
						memberId: await memberId(orgId, reader.userId),
						role,
						organizationId: orgId,
					},
					headers: admin.headers,
				}),
			).rejects.toThrow();
		}
		expect(
			await orgServices.getMemberRole(db, { orgId, userId: reader.userId }),
		).toBe("member");
	});

	test("a corrupted role row fails closed", async () => {
		await db
			.update(schema.organizationRole)
			.set({ permission: JSON.stringify({ member: ["update"] }) })
			.where(eq(schema.organizationRole.organizationId, orgId));
		expect(await permissionsOf(moderator.userId)).toEqual([]);
		await db
			.update(schema.organizationRole)
			.set({
				permission: JSON.stringify(
					scopesToStatements({ moderation: "manage" }),
				),
			})
			.where(eq(schema.organizationRole.organizationId, orgId));
	});
});
