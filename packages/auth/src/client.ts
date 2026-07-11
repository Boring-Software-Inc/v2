import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client. The handler is mounted ON the web head
 * (server/routes/api/auth) so /api/auth is natively same-origin.
 */
export const authClient = createAuthClient({
	basePath: "/api/auth",
});
