import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { orgAc, orgRoles } from "./org-access.ts";

/**
 * Browser-side auth client. The handler is mounted ON the web head
 * (server/routes/api/auth) so /api/auth is natively same-origin.
 *
 * The organization client mirrors the server's two-role AC so
 * `checkRolePermission` agrees with the server — but remember the client is
 * COSMETIC: the real boundary is the server-fn role middlewares.
 */
export const authClient = createAuthClient({
	basePath: "/api/auth",
	plugins: [
		organizationClient({
			ac: orgAc,
			roles: orgRoles,
		}),
	],
});
