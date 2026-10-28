import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type OrgRequirement, resolveOrgAccess } from "@tripwire/auth/org-gate";
import { orgPermissionSchema, scopesToStatements } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { SERVER_FN_CLASSIFICATION } from "#/lib/server-fn-classification";
import { discoverServerFns, ORG_SHELL } from "#/lib/server-fn-discovery";

let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];

const ORG_SLUG = "scoped-team";
const USERS = {
	admin: generateId(),
	member: generateId(),
	moderator: generateId(),
	outsider: generateId(),
};

function requirementOf(fn: {
	orgRole: "admin" | "member" | null;
	permission: string | null;
}): OrgRequirement | null {
	if (fn.orgRole === "member") {
		return { kind: "membership" };
	}
	if (fn.permission !== null) {
		return {
			kind: "permission",
			permission: orgPermissionSchema.parse(fn.permission),
		};
	}
	return null;
}

const ORG_FNS = discoverServerFns().flatMap((fn) => {
	const requirement = requirementOf(fn);
	return requirement ? [{ name: fn.name, method: fn.method, requirement }] : [];
});

async function allowed(
	userId: string,
	requirement: OrgRequirement,
): Promise<boolean> {
	const result = await resolveOrgAccess(db, {
		userId,
		orgSlug: ORG_SLUG,
		requirement,
	});
	return result.ok;
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	const orgId = generateId();
	await db.insert(schema.user).values(
		Object.entries(USERS).map(([name, id]) => ({
			id,
			name,
			email: `${name}@scoped.test`,
			emailVerified: true,
		})),
	);
	await db.insert(schema.organization).values({
		id: orgId,
		name: "Scoped Team",
		slug: ORG_SLUG,
	});
	await db.insert(schema.organizationRole).values({
		id: generateId(),
		organizationId: orgId,
		role: "moderator",
		permission: JSON.stringify(scopesToStatements({ moderation: "manage" })),
	});
	await db.insert(schema.member).values([
		{
			id: generateId(),
			organizationId: orgId,
			userId: USERS.admin,
			role: "admin",
		},
		{
			id: generateId(),
			organizationId: orgId,
			userId: USERS.member,
			role: "member",
		},
		{
			id: generateId(),
			organizationId: orgId,
			userId: USERS.moderator,
			role: "moderator",
		},
	]);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("every org server fn, gated on a real database", () => {
	test("discovery finds the org surface", () => {
		expect(ORG_FNS.length).toBeGreaterThan(50);
		expect(ORG_FNS.map((fn) => fn.name)).toContain("decideModeration");
	});

	test("the moderator reaches the shell and human review, and nothing else", async () => {
		const reached: string[] = [];
		for (const fn of ORG_FNS) {
			if (await allowed(USERS.moderator, fn.requirement)) {
				reached.push(fn.name);
			}
		}
		expect(reached.sort()).toEqual(
			[
				...ORG_SHELL,
				"listModerationQueue",
				"decideModeration",
				"getRepoSetup",
			].sort(),
		);
	});

	test("the moderator cannot call any manage fn outside human review", async () => {
		const manageFns = Object.entries(SERVER_FN_CLASSIFICATION)
			.filter(([, cls]) => cls.endsWith(":manage"))
			.map(([name]) => name)
			.filter((name) => name !== "decideModeration");
		expect(manageFns.length).toBeGreaterThan(30);
		for (const name of manageFns) {
			const fn = ORG_FNS.find((entry) => entry.name === name);
			if (!fn) {
				throw new Error(`${name} is classified but not discovered`);
			}
			expect({
				name,
				ok: await allowed(USERS.moderator, fn.requirement),
			}).toEqual({ name, ok: false });
		}
	});

	test("a plain member reads every region and mutates only the shell", async () => {
		for (const fn of ORG_FNS) {
			const expected =
				fn.requirement.kind === "membership" ||
				(fn.requirement.kind === "permission" &&
					fn.requirement.permission.endsWith(":read"));
			expect({
				name: fn.name,
				ok: await allowed(USERS.member, fn.requirement),
			}).toEqual({ name: fn.name, ok: expected });
		}
	});

	test("an admin reaches every org fn", async () => {
		for (const fn of ORG_FNS) {
			expect({
				name: fn.name,
				ok: await allowed(USERS.admin, fn.requirement),
			}).toEqual({ name: fn.name, ok: true });
		}
	});

	test("a non-member is refused everywhere as not found", async () => {
		for (const fn of ORG_FNS) {
			const result = await resolveOrgAccess(db, {
				userId: USERS.outsider,
				orgSlug: ORG_SLUG,
				requirement: fn.requirement,
			});
			expect(result.ok ? "ok" : result.denial.code).toBe("NOT_FOUND");
		}
	});

	test("a deleted role leaves its holder with the shell only", async () => {
		const { eq } = await import("drizzle-orm");
		await db
			.delete(schema.organizationRole)
			.where(eq(schema.organizationRole.role, "moderator"));
		const reached: string[] = [];
		for (const fn of ORG_FNS) {
			if (await allowed(USERS.moderator, fn.requirement)) {
				reached.push(fn.name);
			}
		}
		expect(reached.sort()).toEqual([...ORG_SHELL].sort());
	});
});
