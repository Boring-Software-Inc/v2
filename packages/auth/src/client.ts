import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { orgAc, orgRoles } from "./org-access.ts";

export const authClient = createAuthClient({
	basePath: "/api/auth",
	plugins: [
		organizationClient({
			ac: orgAc,
			roles: orgRoles,
		}),
	],
});
