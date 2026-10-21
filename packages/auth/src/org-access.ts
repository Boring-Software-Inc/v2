import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Exactly TWO roles (§org-model): member reads everything in the org; admin
 * additionally mutates. There is deliberately no "owner" — the plugin's
 * `creatorRole: "admin"` makes the creator a plain admin, and the last-admin
 * guard (hooks + leave route) keeps every org at ≥1 admin. Deny-by-default:
 * a statement not granted here is refused by the plugin's AC, and our
 * server-fn middlewares (`orgAdminMiddleware`/`orgMemberMiddleware`) enforce
 * the same two-role line on every product surface.
 *
 * `team` and `ac` statements exist in defaultStatements but neither feature
 * is enabled — granting none of them keeps those endpoints dead even if a
 * future upgrade turns something on implicitly.
 */
const productStatement = {
	repoResponse: ["update"],
	orgResponseDefaults: ["update"],
} as const;

const statement = { ...defaultStatements, ...productStatement } as const;

export const orgAc = createAccessControl(statement);

export const orgAdminRole = orgAc.newRole({
	organization: ["update"], // delete is disabled plugin-wide; ours re-checks
	member: ["create", "update", "delete"],
	invitation: ["create", "cancel"], // dormant path, hard-refused by hook anyway
	repoResponse: ["update"],
	orgResponseDefaults: ["update"],
});

export const orgMemberRole = orgAc.newRole({});

export const orgRoles = {
	admin: orgAdminRole,
	member: orgMemberRole,
};

type ProductStatement = typeof productStatement;

export type OrgPermission = {
	[R in keyof ProductStatement]: `${R}:${ProductStatement[R][number]}`;
}[keyof ProductStatement];

export const ORG_PERMISSIONS = (
	Object.entries(productStatement) as [string, readonly string[]][]
).flatMap(([resource, actions]) =>
	actions.map((action) => `${resource}:${action}`),
) as OrgPermission[];

function isOrgRoleName(name: string): name is keyof typeof orgRoles {
	return name in orgRoles;
}

function roleAuthorizes(roleName: string, permission: OrgPermission): boolean {
	if (!isOrgRoleName(roleName)) {
		return false;
	}
	const [resource, action] = permission.split(":") as [
		keyof ProductStatement,
		"update",
	];
	return orgRoles[roleName].authorize({ [resource]: [action] }).success;
}

export function permissionsForRole(role: string): OrgPermission[] {
	const held = role
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	return ORG_PERMISSIONS.filter((permission) =>
		held.some((name) => roleAuthorizes(name, permission)),
	);
}

export function roleHasPermission(
	role: string,
	permission: OrgPermission,
): boolean {
	return permissionsForRole(role).includes(permission);
}
