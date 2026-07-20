import type { Db } from "@tripwire/db";
import { schema } from "@tripwire/db";
import { eq } from "drizzle-orm";

/**
 * Platform staff gate — the same architecture as `assertApproved` and
 * `assertOrgRole`: read the bit FRESH from the DB on every request (never from
 * session claims), so a revocation takes effect on the next request without
 * re-auth. The field is `input: false` in Better Auth; the only write path is
 * the grant-admin CLI script.
 *
 * Callers turn a `false` into a 404, not a 403 — non-staff must not be able
 * to learn /admin exists (same posture as non-member org URLs).
 */
export async function isPlatformAdmin(
	db: Db,
	userId: string,
): Promise<boolean> {
	const rows = await db
		.select({ isPlatformAdmin: schema.user.isPlatformAdmin })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.limit(1);
	return rows[0]?.isPlatformAdmin === true;
}
