import {
	ORG_PERMISSIONS,
	ORG_REGIONS,
	type OrgPermission,
	type OrgRegion,
	type OrgRoleStatements,
	orgRoleStatementsSchema,
} from "@tripwire/contracts";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

export type { OrgPermission };
export { ORG_PERMISSIONS };

const READ_MANAGE = ["read", "manage"] as const;

const productStatement = {
	moderation: READ_MANAGE,
	activity: READ_MANAGE,
	rules: READ_MANAGE,
	workflows: READ_MANAGE,
	responses: READ_MANAGE,
	analytics: READ_MANAGE,
	connections: READ_MANAGE,
	members: READ_MANAGE,
	settings: READ_MANAGE,
} as const satisfies Record<OrgRegion, typeof READ_MANAGE>;

const statement = { ...defaultStatements, ...productStatement } as const;

export const orgAc = createAccessControl(statement);

export const orgAdminRole = orgAc.newRole({
	organization: ["update"],
	member: ["create", "update", "delete"],
	invitation: ["create", "cancel"],
	ac: ["create", "read", "update", "delete"],
	moderation: ["read", "manage"],
	activity: ["read", "manage"],
	rules: ["read", "manage"],
	workflows: ["read", "manage"],
	responses: ["read", "manage"],
	analytics: ["read", "manage"],
	connections: ["read", "manage"],
	members: ["read", "manage"],
	settings: ["read", "manage"],
});

export const orgMemberRole = orgAc.newRole({
	moderation: ["read"],
	activity: ["read"],
	rules: ["read"],
	workflows: ["read"],
	responses: ["read"],
	analytics: ["read"],
	connections: ["read"],
	members: ["read"],
	settings: ["read"],
});

export const orgRoles = {
	admin: orgAdminRole,
	member: orgMemberRole,
};

type AuthorizingRole = Pick<typeof orgMemberRole, "authorize">;

export interface CustomOrgRoleRow {
	role: string;
	permission: string;
}

function isBuiltInRole(name: string): name is keyof typeof orgRoles {
	return Object.hasOwn(orgRoles, name);
}

export function parseRoleStatements(raw: string): OrgRoleStatements | null {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	const parsed = orgRoleStatementsSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

export function roleNames(role: string): string[] {
	return role
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
}

function rolesFor(
	role: string,
	customRoles: readonly CustomOrgRoleRow[],
): AuthorizingRole[] {
	const held: AuthorizingRole[] = [];
	for (const name of roleNames(role)) {
		if (isBuiltInRole(name)) {
			held.push(orgRoles[name]);
			continue;
		}
		const row = customRoles.find((custom) => custom.role === name);
		const statements = row ? parseRoleStatements(row.permission) : null;
		if (statements) {
			held.push(orgAc.newRole(statements));
		}
	}
	return held;
}

export function resolveOrgPermissions(
	role: string,
	customRoles: readonly CustomOrgRoleRow[] = [],
): OrgPermission[] {
	const held = rolesFor(role, customRoles);
	const permissions: OrgPermission[] = [];
	for (const region of ORG_REGIONS) {
		const manage = held.some(
			(entry) => entry.authorize({ [region]: ["manage"] }).success,
		);
		const read =
			manage ||
			held.some((entry) => entry.authorize({ [region]: ["read"] }).success);
		if (read) {
			permissions.push(`${region}:read`);
		}
		if (manage) {
			permissions.push(`${region}:manage`);
		}
	}
	return permissions;
}

export function permissionsForRole(role: string): OrgPermission[] {
	return resolveOrgPermissions(role);
}

export function roleHasPermission(
	role: string,
	permission: OrgPermission,
): boolean {
	return permissionsForRole(role).includes(permission);
}

export function isBuiltInOrgRole(name: string): boolean {
	return isBuiltInRole(name);
}
