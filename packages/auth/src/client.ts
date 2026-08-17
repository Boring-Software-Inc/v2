import {
	genericOAuthClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { orgAc, orgRoles } from "./org-access.ts";

export const authClient = createAuthClient({
	basePath: "/api/auth",
	plugins: [
		// Always mounted, even when no generic provider is configured server-side:
		// it only adds `signIn.oauth2` / `oauth2.link` to the client surface, and a
		// call for an unconfigured providerId fails server-side where it should.
		genericOAuthClient(),
		organizationClient({
			ac: orgAc,
			roles: orgRoles,
		}),
	],
});
