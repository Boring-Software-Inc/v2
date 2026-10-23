import { describe, expect, test } from "bun:test";
import {
	ORG_REGIONS,
	type OrgAccessLevel,
	type OrgPermission,
	type OrgRegion,
	type OrgRoleScopes,
	type OrgScopeLevels,
	orgRoleScopesSchema,
	scopesToStatements,
} from "@tripwire/contracts";
import {
	ORG_PERMISSIONS,
	parseRoleStatements,
	permissionsForRole,
	resolveOrgPermissions,
	roleHasPermission,
} from "./org-access.ts";

const READS = ORG_PERMISSIONS.filter((p) => p.endsWith(":read"));

function custom(role: string, permission: string) {
	return { role, permission };
}

describe("built-in roles", () => {
	test("the permission list is every region at read and manage", () => {
		expect(ORG_PERMISSIONS).toHaveLength(ORG_REGIONS.length * 2);
		expect(new Set(ORG_PERMISSIONS).size).toBe(ORG_PERMISSIONS.length);
	});

	test("admins hold every permission", () => {
		expect(permissionsForRole("admin")).toEqual([...ORG_PERMISSIONS]);
	});

	test("members read every region and manage none", () => {
		expect(permissionsForRole("member")).toEqual(READS);
		for (const permission of ORG_PERMISSIONS) {
			expect(roleHasPermission("member", permission)).toBe(
				permission.endsWith(":read"),
			);
		}
	});

	test("an unknown or empty role holds nothing", () => {
		expect(permissionsForRole("owner")).toEqual([]);
		expect(permissionsForRole("")).toEqual([]);
		expect(permissionsForRole("moderator")).toEqual([]);
		expect(permissionsForRole("constructor")).toEqual([]);
		expect(permissionsForRole("__proto__")).toEqual([]);
	});

	test("a multi-role string unions its roles", () => {
		expect(permissionsForRole("member, admin")).toEqual([...ORG_PERMISSIONS]);
	});
});

describe("custom roles", () => {
	const moderator = custom(
		"moderator",
		JSON.stringify({ moderation: ["read", "manage"] }),
	);

	test("a moderator holds human review and nothing else", () => {
		expect(resolveOrgPermissions("moderator", [moderator])).toEqual([
			"moderation:read",
			"moderation:manage",
		]);
	});

	test("manage implies read even when the stored row omits read", () => {
		expect(
			resolveOrgPermissions("x", [
				custom("x", JSON.stringify({ rules: ["manage"] })),
			]),
		).toEqual(["rules:read", "rules:manage"]);
	});

	test("a role row only applies to the role it names", () => {
		expect(resolveOrgPermissions("triage", [moderator])).toEqual([]);
	});

	test("a custom row can never change a built-in role", () => {
		const rogue = custom(
			"member",
			JSON.stringify({ settings: ["read", "manage"] }),
		);
		expect(resolveOrgPermissions("member", [rogue])).toEqual(READS);
	});

	test("malformed rows fail closed", () => {
		const rows = [
			{ role: "a", permission: "not json" },
			custom("b", JSON.stringify({ organization: ["update"] })),
			custom("c", JSON.stringify({ moderation: ["delete"] })),
			custom("d", JSON.stringify({ moderation: [] })),
			custom("e", JSON.stringify(["moderation"])),
			custom("f", JSON.stringify(null)),
			custom("g", JSON.stringify({ moderation: "manage" })),
			custom("h", JSON.stringify({ member: ["update"], moderation: ["read"] })),
		];
		for (const row of rows) {
			expect(resolveOrgPermissions(row.role, rows)).toEqual([]);
		}
	});

	test("plugin statements never parse as product scopes", () => {
		expect(parseRoleStatements(JSON.stringify({ ac: ["create"] }))).toBeNull();
		expect(
			parseRoleStatements(JSON.stringify({ member: ["update"] })),
		).toBeNull();
	});
});

const GRANTABLE = {
	moderation: [undefined, "read", "manage"],
	activity: [undefined, "read", "manage"],
	rules: [undefined, "read", "manage"],
	workflows: [undefined, "read", "manage"],
	responses: [undefined, "read", "manage"],
	analytics: [undefined, "read", "manage"],
	connections: [undefined, "read", "manage"],
	members: [undefined, "read"],
	settings: [undefined, "read"],
} satisfies Record<OrgRegion, readonly (OrgAccessLevel | undefined)[]>;

function* everyScopeSet(
	index = 0,
	acc: OrgScopeLevels = {},
): Generator<OrgScopeLevels> {
	const region = ORG_REGIONS[index];
	if (!region) {
		yield acc;
		return;
	}
	for (const level of GRANTABLE[region]) {
		yield* everyScopeSet(
			index + 1,
			level ? { ...acc, [region]: level } : { ...acc },
		);
	}
}

function expected(scopes: OrgScopeLevels): OrgPermission[] {
	return ORG_REGIONS.flatMap((region) => {
		const held = scopes[region];
		const out: OrgPermission[] = [];
		if (held) {
			out.push(`${region}:read`);
		}
		if (held === "manage") {
			out.push(`${region}:manage`);
		}
		return out;
	});
}

describe("every grantable scope set round-trips exactly", () => {
	test("schema, stored statements and resolution agree", () => {
		let checked = 0;
		for (const scopes of everyScopeSet()) {
			const parsed = orgRoleScopesSchema.safeParse(scopes);
			const empty = Object.keys(scopes).length === 0;
			expect(parsed.success).toBe(!empty);
			if (!parsed.success) {
				continue;
			}
			const valid: OrgRoleScopes = parsed.data;
			const row = custom("r", JSON.stringify(scopesToStatements(valid)));
			expect(resolveOrgPermissions("r", [row])).toEqual(expected(scopes));
			checked++;
		}
		expect(checked).toBe(3 ** 7 * 2 ** 2 - 1);
	});

	test("manage on members and settings is never grantable", () => {
		expect(orgRoleScopesSchema.safeParse({ members: "manage" }).success).toBe(
			false,
		);
		expect(orgRoleScopesSchema.safeParse({ settings: "manage" }).success).toBe(
			false,
		);
		expect(
			orgRoleScopesSchema.safeParse({ moderation: "read", billing: "read" })
				.success,
		).toBe(false);
	});
});
