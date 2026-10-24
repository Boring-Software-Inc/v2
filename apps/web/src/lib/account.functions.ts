import { createServerFn } from "@tanstack/react-start";
import type { AccountDeletionPlan } from "@tripwire/auth/account-deletion";
import { z } from "zod";
import {
	accessGuardMiddleware,
	notImpersonatingMiddleware,
} from "#/lib/server/gated-server-fn";

const FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

const sessionIdInput = z.object({ sessionId: z.string().min(1) });
const deleteAccountInput = z.object({ confirm: z.string().min(1).max(200) });

export interface AccountSession {
	id: string;
	userAgent: string | null;
	createdAt: string;
	lastActiveAt: string;
	current: boolean;
}

export type AccountDeletionView = AccountDeletionPlan & {
	confirmText: string;
	freshSession: boolean;
};

export type DeleteAccountResult =
	| { ok: true }
	| { ok: false; error: string; signInAgain?: boolean };

async function accountContext() {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		throw new Error("Sign-in is turned off on this server.");
	}
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const headers = getStartContext().request.headers;
	const session = await auth.api.getSession({ headers });
	if (!session) {
		throw new Error("Your session ended. Sign in again to continue.");
	}
	return { auth, headers, session };
}

async function loginOf(userId: string, fallback: string): Promise<string> {
	const { getDb } = await import("#/lib/server/db");
	const { forgeIdentities } = await import("@tripwire/db");
	const { eq } = await import("drizzle-orm");
	const rows = await getDb()
		.db.select({ username: forgeIdentities.username })
		.from(forgeIdentities)
		.where(eq(forgeIdentities.userId, userId))
		.limit(1);
	return rows[0]?.username ?? fallback;
}

function isFresh(createdAt: Date, now = Date.now()): boolean {
	return now - createdAt.getTime() < FRESH_SESSION_MS;
}

export const listMySessions = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<AccountSession[]> => {
		const { auth, headers, session } = await accountContext();
		const sessions = await auth.api.listSessions({ headers });
		return sessions
			.map((entry) => ({
				id: entry.id,
				userAgent: entry.userAgent ?? null,
				createdAt: new Date(entry.createdAt).toISOString(),
				lastActiveAt: new Date(entry.updatedAt).toISOString(),
				current: entry.id === session.session.id,
			}))
			.sort(
				(a, b) =>
					Number(b.current) - Number(a.current) ||
					b.lastActiveAt.localeCompare(a.lastActiveAt),
			);
	});

export const revokeMySession = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, notImpersonatingMiddleware])
	.inputValidator((input: { sessionId: string }) => sessionIdInput.parse(input))
	.handler(async ({ data }): Promise<{ ok: true }> => {
		const { auth, headers, session } = await accountContext();
		if (data.sessionId === session.session.id) {
			throw new Error("Use Sign out to end this session.");
		}
		const sessions = await auth.api.listSessions({ headers });
		const target = sessions.find((entry) => entry.id === data.sessionId);
		if (!target) {
			throw new Error("This session already ended. Reload the list.");
		}
		await auth.api.revokeSession({ body: { token: target.token }, headers });
		return { ok: true };
	});

export const revokeMyOtherSessions = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, notImpersonatingMiddleware])
	.handler(async (): Promise<{ ok: true }> => {
		const { auth, headers } = await accountContext();
		await auth.api.revokeOtherSessions({ headers });
		return { ok: true };
	});

export const getAccountDeletionPlan = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<AccountDeletionView> => {
		const { session } = await accountContext();
		const { getDb } = await import("#/lib/server/db");
		const { planAccountDeletion } = await import(
			"@tripwire/auth/account-deletion"
		);
		const plan = await planAccountDeletion(getDb().db, session.user.id);
		return {
			...plan,
			confirmText: await loginOf(session.user.id, session.user.name),
			freshSession: isFresh(new Date(session.session.createdAt)),
		};
	});

export const deleteMyAccount = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, notImpersonatingMiddleware])
	.inputValidator((input: { confirm: string }) =>
		deleteAccountInput.parse(input),
	)
	.handler(async ({ data }): Promise<DeleteAccountResult> => {
		const { session } = await accountContext();
		const userId = session.user.id;
		const expected = await loginOf(userId, session.user.name);
		if (data.confirm.trim() !== expected) {
			return { ok: false, error: `Type ${expected} to confirm.` };
		}
		if (!isFresh(new Date(session.session.createdAt))) {
			return {
				ok: false,
				error: "Sign in again, then delete your account.",
				signInAgain: true,
			};
		}
		const { getDb } = await import("#/lib/server/db");
		const { deleteAccount } = await import("@tripwire/auth/account-deletion");
		const result = await deleteAccount(getDb().db, userId);
		if (result.ok) {
			return { ok: true };
		}
		if (result.reason === "sole-admin") {
			return {
				ok: false,
				error: `You are the only admin of ${result.orgSlugs.join(", ")}. Add another admin or delete the org first.`,
			};
		}
		return {
			ok: false,
			error: `Tripwire is still on for ${result.repos.join(", ")}. Turn it off first.`,
		};
	});
