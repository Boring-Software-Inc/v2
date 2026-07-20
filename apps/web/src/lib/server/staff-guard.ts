import { createMiddleware } from "@tanstack/react-start";

/**
 * Platform-staff function middleware — the deny-by-default boundary for every
 * /admin server function, layered AFTER `accessGuardMiddleware`:
 *
 *   createServerFn({ method })
 *     .middleware([accessGuardMiddleware, platformAdminMiddleware])
 *     .handler(async ({ context }) => { context.staff.userId ... })
 *
 * Resolves `user.isPlatformAdmin` FRESH from the DB via the staff gate (never
 * session claims — revocation is instant). Every denial is a 404, including
 * "no session": non-staff must not learn /admin exists, the same posture as
 * non-member org URLs. The structural boundary test asserts every fn in
 * admin.functions.ts carries this middleware ("staff" class).
 *
 * `context.staff.userId` is the acting admin — handlers stamp it into audit
 * columns (accessReviewedBy).
 */
export const platformAdminMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next }) => {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		// Open-dev posture (no auth env): the gate stands open like the rest of
		// the stack; production refuses to boot without a secret.
		return next({ context: { staff: { userId: "dev" } } });
	}
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const session = await auth.api.getSession({
		headers: getStartContext().request.headers,
	});
	if (!session) {
		throw new Response("not found", { status: 404 });
	}
	const { isPlatformAdmin } = await import("@tripwire/auth/staff-gate");
	const { getDb } = await import("#/lib/server/db");
	if (!(await isPlatformAdmin(getDb().db, session.user.id))) {
		throw new Response("not found", { status: 404 });
	}
	return next({ context: { staff: { userId: session.user.id } } });
});

export type StaffContext = { staff: { userId: string } };
