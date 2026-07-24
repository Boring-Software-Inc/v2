import { redirect } from "@tanstack/react-router";

/**
 * Server-side session reads + the §10 gate for mutating and list-shaped
 * server functions. Open-dev posture (no auth env) leaves the gate open;
 * with auth enabled, no session ⇒ redirect to /login — never a silent read.
 * The gate throws `redirect()` (not a raw `Response`) so it survives the
 * server-fn RPC boundary; a thrown `Response` can't be serialized (Seroval).
 */

export interface SessionState {
	/** false when auth env is absent (open-dev posture, resolveAuthPosture). */
	authEnabled: boolean;
	userId: string | null;
}

export async function readSessionState(): Promise<SessionState> {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		return { authEnabled: false, userId: null };
	}
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const session = await auth.api.getSession({
		headers: getStartContext().request.headers,
	});
	return { authEnabled: true, userId: session?.user.id ?? null };
}

/** Pure gate decision — redirects to /login when a session is required. */
export function assertSession(state: SessionState): void {
	if (state.authEnabled && !state.userId) {
		throw redirect({ to: "/login" });
	}
}

/**
 * Gate for session-only server functions. Returns the user id for audit
 * fields (null in open-dev, where there is no auth to attribute).
 */
export async function requireSession(): Promise<string | null> {
	const state = await readSessionState();
	assertSession(state);
	return state.userId;
}
