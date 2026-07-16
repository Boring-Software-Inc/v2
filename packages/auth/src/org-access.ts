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
const statement = defaultStatements;

export const orgAc = createAccessControl(statement);

export const orgAdminRole = orgAc.newRole({
	organization: ["update"], // delete is disabled plugin-wide; ours re-checks
	member: ["create", "update", "delete"],
	invitation: ["create", "cancel"], // dormant path, hard-refused by hook anyway
});

export const orgMemberRole = orgAc.newRole({});

export const orgRoles = {
	admin: orgAdminRole,
	member: orgMemberRole,
};
