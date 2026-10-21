import { createMiddleware } from "@tanstack/react-start";

/**
 * Access-gate function middleware — the real invariant-3 boundary for the web
 * head. Server functions are HTTP endpoints, so route-level gating (beforeLoad)
 * is only UX; THIS is what actually blocks a pending/rejected user from calling
 * product data directly.
 *
 * Open-dev posture (no BETTER_AUTH_SECRET → auth null) stands open, like the
 * rest of the stack. Otherwise: no session → reject; gate on + not approved →
 * reject. Same server-side flag evaluation (`assertApproved`) the Hono SSE
 * endpoint uses, so web and API can't disagree.
 */
export const accessGuardMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next }) => {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		return next();
	}
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const session = await auth.api.getSession({
		headers: getStartContext().request.headers,
	});
	if (!session) {
		throw new Error("Your session ended. Sign in again to continue.");
	}
	const { assertApproved } = await import("@tripwire/auth/access-gate");
	const { getDb } = await import("#/lib/server/db");
	const { presenceServices } = await import("@tripwire/db");
	presenceServices.touchLastSeen(getDb().db, session.user.id).catch((error) => {
		console.error("[presence] last seen write failed:", error);
	});
	const denial = await assertApproved(
		getDb().db,
		session.user.id,
		session.user.email,
	);
	if (denial) {
		throw new Error(denial.message);
	}
	return next();
});

/**
 * Access-gate EVERY server function that returns product/repo data by chaining
 * this middleware directly on a literal `createServerFn`:
 *
 *   export const getThing = createServerFn({ method: "GET" })
 *     .middleware([accessGuardMiddleware])
 *     .handler(async () => { ... });
 *
 * DO NOT re-wrap `createServerFn` in a helper (the old `gatedServerFn`). The
 * TanStack Start compiler only splits the server body out of the client bundle
 * when it can statically see a literal `createServerFn(...).handler(...)` call;
 * hiding it behind a wrapper defeats that, and the handler — with its
 * server-only imports and `process.env` — ships to and runs in the BROWSER.
 * That silently breaks every gated call client-side. `server-fn-boundary.test.ts`
 * enforces that each product endpoint carries this middleware; bare
 * `createServerFn` is reserved for the explicit public allowlist there.
 */
