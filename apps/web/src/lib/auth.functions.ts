import { createServerFn } from "@tanstack/react-start";
import type { AccessStatus } from "@tripwire/contracts";

export interface SessionInfo {
	/** null when signed out; "disabled" when auth env is absent (local dev). */
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
		/** Closed-beta access queue status (server-assigned). */
		accessStatus: AccessStatus;
		timezone: string | null;
		reduceAgentMotion: boolean;
	} | null;
	authEnabled: boolean;
	/**
	 * Where `/` should land: the last-visited org (session breadcrumb) when
	 * the caller is still a member there, else their personal org. NEVER an
	 * authority for scope — the URL is (§8). Null when signed out / open-dev.
	 */
	defaultOrgSlug: string | null;
	/**
	 * Is the closed-beta gate on? Server-evaluated (Databuddy `access-gate` flag
	 * + env fallback) — the SAME decision the API boundary enforces, so the
	 * route gate can never disagree with what the server actually blocks.
	 */
	gateEnabled: boolean;
	impersonation?: {
		login: string | null;
		expiresAt: string;
	} | null;
}

export const getSessionInfo = createServerFn({ method: "GET" }).handler(
	async (): Promise<SessionInfo> => {
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			return {
				user: null,
				authEnabled: false,
				defaultOrgSlug: null,
				gateEnabled: false,
			};
		}
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const { request } = getStartContext();
		const session = await auth.api.getSession({ headers: request.headers });
		if (!session) {
			return {
				user: null,
				authEnabled: true,
				defaultOrgSlug: null,
				gateEnabled: false,
			};
		}
		const {
			orgServices,
			session: sessionTable,
			user: userTable,
		} = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const { eq } = await import("drizzle-orm");
		const { isAccessGateEnabled } = await import("@tripwire/auth/access-gate");
		const db = getDb().db;
		const rows = await db
			.select({
				accessStatus: userTable.accessStatus,
				timezone: userTable.timezone,
				reduceAgentMotion: userTable.reduceAgentMotion,
			})
			.from(userTable)
			.where(eq(userTable.id, session.user.id))
			.limit(1);
		const accessStatus: AccessStatus = rows[0]?.accessStatus ?? "pending";
		const gateEnabled = await isAccessGateEnabled({
			userId: session.user.id,
			email: session.user.email,
		});
		// `/` redirect target: the session's last-visited org while membership
		// still holds, else the personal org (every user has one).
		const orgs = await orgServices.listUserOrgs(db, session.user.id);
		const sessionRows = await db
			.select({ activeOrganizationId: sessionTable.activeOrganizationId })
			.from(sessionTable)
			.where(eq(sessionTable.id, session.session.id))
			.limit(1);
		const lastVisited = sessionRows[0]?.activeOrganizationId ?? null;
		const defaultOrgSlug =
			orgs.find((o) => o.id === lastVisited)?.slug ??
			orgs.find((o) => o.isPersonal)?.slug ??
			orgs[0]?.slug ??
			null;
		const { fenceOf } = await import("#/lib/server/staff-users");
		const impersonating = (await fenceOf(session)).impersonatedBy;
		const { staffUserServices } = await import("@tripwire/db");
		const impersonation = impersonating
			? {
					login:
						(await staffUserServices.getUserLogins(db, session.user.id))[0] ??
						null,
					expiresAt: new Date(session.session.expiresAt).toISOString(),
				}
			: null;
		return {
			impersonation,
			user: {
				id: session.user.id,
				name: session.user.name,
				email: session.user.email,
				image: session.user.image ?? null,
				accessStatus,
				timezone: rows[0]?.timezone ?? null,
				reduceAgentMotion: rows[0]?.reduceAgentMotion ?? false,
			},
			authEnabled: true,
			defaultOrgSlug,
			gateEnabled,
		};
	},
);

/**
 * The signed-in maintainer as the topbar shows them (§10). Null in open-dev
 * (no auth env) or signed out — the topbar renders a placeholder, never a
 * fabricated identity. `login` is the forge handle from `forge_identities`.
 */
export interface CurrentUser {
	id: string;
	name: string;
	login: string;
	email: string | null;
	image: string | null;
}

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
	async (): Promise<CurrentUser | null> => {
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			return null;
		}
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const session = await auth.api.getSession({
			headers: getStartContext().request.headers,
		});
		if (!session) {
			return null;
		}
		const { getDb } = await import("#/lib/server/db");
		const { forgeIdentities } = await import("@tripwire/db");
		const { eq } = await import("drizzle-orm");
		const rows = await getDb()
			.db.select({ username: forgeIdentities.username })
			.from(forgeIdentities)
			.where(eq(forgeIdentities.userId, session.user.id))
			.limit(1);
		return {
			id: session.user.id,
			name: session.user.name,
			login: rows[0]?.username ?? session.user.name,
			email: session.user.email ?? null,
			image: session.user.image ?? null,
		};
	},
);
