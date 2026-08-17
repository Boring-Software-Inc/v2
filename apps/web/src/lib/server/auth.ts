import {
	type Auth,
	createAuth,
	resolveAuthPosture,
} from "@tripwire/auth/server";
import { getDb } from "#/lib/server/db";

/**
 * The web head's Better Auth instance — the nitro server route mounts its
 * handler; server functions read sessions from it. null in dev when auth env
 * is absent (fail-closed in production via resolveAuthPosture).
 */
let instance: Auth | null | undefined;

export function getAuth(): Auth | null {
	if (instance !== undefined) {
		return instance;
	}
	const secret = process.env.BETTER_AUTH_SECRET;
	const posture = resolveAuthPosture({
		secret,
		nodeEnv: process.env.NODE_ENV,
	});
	if (posture === "open-dev" || !secret) {
		instance = null;
		return instance;
	}
	const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
	const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
	const openGitClientId = process.env.OPENGIT_OAUTH_CLIENT_ID;
	const openGitClientSecret = process.env.OPENGIT_OAUTH_CLIENT_SECRET;
	instance = createAuth({
		db: getDb().db,
		secret,
		baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
		github: clientId && clientSecret ? { clientId, clientSecret } : null,
		// `OPENGIT_ORIGIN` points a self-hosted open-git at its own URL; omit it
		// for open-git.com. Discovery hangs off that origin.
		opengit:
			openGitClientId && openGitClientSecret
				? {
						clientId: openGitClientId,
						clientSecret: openGitClientSecret,
						...(process.env.OPENGIT_ORIGIN
							? { origin: process.env.OPENGIT_ORIGIN }
							: {}),
					}
				: null,
		// Better Auth Infrastructure (dash) — this head mounts /api/auth/* (thus
		// /dash/*), so the key lives here. Undefined ⇒ dash stays inert.
		infraApiKey: process.env.BETTER_AUTH_API_KEY,
		// Compile-time DEV flag: production bundles never enable email/password.
		devLogin: import.meta.env.DEV,
	});
	return instance;
}
