import { z } from "zod";
import { orgRoleSchema } from "./org.ts";

export const ORG_REGIONS = [
	"moderation",
	"activity",
	"rules",
	"workflows",
	"responses",
	"analytics",
	"connections",
	"members",
	"settings",
] as const;
export const orgRegionSchema = z.enum(ORG_REGIONS);
export type OrgRegion = z.infer<typeof orgRegionSchema>;

export const ORG_ACCESS_LEVELS = ["read", "manage"] as const;
export const orgAccessLevelSchema = z.enum(ORG_ACCESS_LEVELS);
export type OrgAccessLevel = z.infer<typeof orgAccessLevelSchema>;

export const orgPermissionSchema = z.templateLiteral([
	orgRegionSchema,
	":",
	orgAccessLevelSchema,
]);
export type OrgPermission = z.infer<typeof orgPermissionSchema>;

export const ORG_PERMISSIONS: readonly OrgPermission[] = ORG_REGIONS.flatMap(
	(region) => ORG_ACCESS_LEVELS.map((level) => `${region}:${level}` as const),
);

export const ADMIN_ONLY_MANAGE_REGIONS = ["members", "settings"] as const;

export const ORG_REGION_LABELS = {
	moderation: "Human review",
	activity: "Activity",
	rules: "Rules",
	workflows: "Workflows",
	responses: "Responses and redaction",
	analytics: "Analytics",
	connections: "Connections",
	members: "Members",
	settings: "Org settings",
} satisfies Record<OrgRegion, string>;

export const orgRoleScopesSchema = z
	.object({
		moderation: orgAccessLevelSchema.optional(),
		activity: orgAccessLevelSchema.optional(),
		rules: orgAccessLevelSchema.optional(),
		workflows: orgAccessLevelSchema.optional(),
		responses: orgAccessLevelSchema.optional(),
		analytics: orgAccessLevelSchema.optional(),
		connections: orgAccessLevelSchema.optional(),
		members: z.literal("read").optional(),
		settings: z.literal("read").optional(),
	})
	.strict()
	.refine((scopes) => Object.values(scopes).some(Boolean), {
		message: "pick at least one area",
	});
export type OrgRoleScopes = z.infer<typeof orgRoleScopesSchema>;

export const orgRoleStatementsSchema = z.partialRecord(
	orgRegionSchema,
	z.array(orgAccessLevelSchema).min(1),
);
export type OrgRoleStatements = z.infer<typeof orgRoleStatementsSchema>;

export function scopesToStatements(scopes: OrgRoleScopes): OrgRoleStatements {
	const statements: OrgRoleStatements = {};
	for (const region of ORG_REGIONS) {
		const level = scopes[region];
		if (level === "manage") {
			statements[region] = ["read", "manage"];
		} else if (level === "read") {
			statements[region] = ["read"];
		}
	}
	return statements;
}

export const orgScopeLevelsSchema = z.partialRecord(
	orgRegionSchema,
	orgAccessLevelSchema,
);
export type OrgScopeLevels = z.infer<typeof orgScopeLevelsSchema>;

export function statementsToScopes(
	statements: OrgRoleStatements,
): OrgScopeLevels {
	const scopes: OrgScopeLevels = {};
	for (const region of ORG_REGIONS) {
		const actions = statements[region];
		if (actions?.includes("manage")) {
			scopes[region] = "manage";
		} else if (actions?.includes("read")) {
			scopes[region] = "read";
		}
	}
	return scopes;
}

export const RESERVED_ORG_ROLE_NAMES = new Set(["admin", "member", "owner"]);

export const customOrgRoleNameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(2, "use at least 2 characters")
	.max(32, "use at most 32 characters")
	.regex(
		/^[a-z][a-z0-9-]*[a-z0-9]$/,
		"use lowercase letters, numbers and hyphens, starting with a letter",
	)
	.refine((name) => !RESERVED_ORG_ROLE_NAMES.has(name), {
		message: "this name is taken by a built-in role",
	});

export const orgRoleInputSchema = z.object({
	name: customOrgRoleNameSchema,
	scopes: orgRoleScopesSchema,
});
export type OrgRoleInput = z.infer<typeof orgRoleInputSchema>;

export const grantableRoleStatementsSchema = orgRoleStatementsSchema.refine(
	(statements) =>
		orgRoleScopesSchema.safeParse(statementsToScopes(statements)).success,
	{ message: "this role grants access a custom role cannot hold" },
);

export const orgRoleCreateBodySchema = z
	.object({
		organizationId: z.string().min(1),
		role: customOrgRoleNameSchema,
		permission: grantableRoleStatementsSchema,
	})
	.strict();

export const orgRoleUpdateBodySchema = z
	.object({
		organizationId: z.string().min(1),
		roleName: z.string().min(1).optional(),
		roleId: z.string().min(1).optional(),
		data: z.object({ permission: grantableRoleStatementsSchema }).strict(),
	})
	.strict();

export const orgMemberRoleInputSchema = z.union([
	orgRoleSchema,
	customOrgRoleNameSchema,
]);
