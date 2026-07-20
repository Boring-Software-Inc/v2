import { generateId } from "@tripwire/utils";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";

/**
 * Accepts the pooled handle OR a transaction — promotion must be composable
 * into larger atomic flows (invite redemption promotes inside its tx).
 */
export type DbLike = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * THE access-status promotion path. `accessStatus` is `input: false` in Better
 * Auth — a client can never write it; every transition to "approved" funnels
 * through here (manual review, invite-link redemption, future admin UI) so the
 * audit fields are always set together and there is exactly one place to gate.
 */
export async function promoteUserAccess(
	db: DbLike,
	input: {
		userId: string;
		/** Who vouched — the reviewing admin or the invite link's creator. */
		reviewedBy: string;
	},
): Promise<{ promoted: boolean }> {
	const rows = await db
		.update(user)
		.set({
			accessStatus: "approved",
			accessReviewedAt: new Date(),
			accessReviewedBy: input.reviewedBy,
		})
		.where(and(eq(user.id, input.userId), ne(user.accessStatus, "approved")))
		.returning({ id: user.id });
	return { promoted: rows.length > 0 };
}

/**
 * THE access-status rejection path — `promoteUserAccess`'s mirror, and the
 * first-ever writer of "rejected" (the enum value predates any write site).
 * Same shape on purpose: audit fields set atomically, idempotent via the
 * status guard. Legal transitions: pending|approved → rejected here,
 * pending|rejected → approved via promote. Both directions are real; the
 * admin portal offers both.
 */
export async function rejectUserAccess(
	db: DbLike,
	input: {
		userId: string;
		/** The reviewing admin. */
		reviewedBy: string;
	},
): Promise<{ rejected: boolean }> {
	const rows = await db
		.update(user)
		.set({
			accessStatus: "rejected",
			accessReviewedAt: new Date(),
			accessReviewedBy: input.reviewedBy,
		})
		.where(and(eq(user.id, input.userId), ne(user.accessStatus, "rejected")))
		.returning({ id: user.id });
	return { rejected: rows.length > 0 };
}

/** Test/seed helper: a user row shaped like a fresh pending signup. */
export function pendingUserRow(input: { name: string; email: string }) {
	return {
		id: generateId(),
		name: input.name,
		email: input.email,
		emailVerified: false,
		accessStatus: "pending" as const,
	};
}
