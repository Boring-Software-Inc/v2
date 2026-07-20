/**
 * Grant closed-beta access to a user by email (§6 access queue).
 *
 *   bun run beta someone@example.com
 *
 * Funnels through `promoteUserAccess` — the ONE promotion path — so the audit
 * fields (`accessReviewedAt`, `accessReviewedBy`) are set exactly like an
 * invite redemption would. Reads DATABASE_URL from the environment (bun loads
 * .env at the repo root); already-approved users are a no-op, not an error.
 */
import { accessServices, createDb, schema } from "@tripwire/db";
import { eq } from "drizzle-orm";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
	console.error("usage: bun run beta <email>");
	process.exit(1);
}

const { db, pool } = createDb();

const rows = await db
	.select({
		id: schema.user.id,
		name: schema.user.name,
		accessStatus: schema.user.accessStatus,
	})
	.from(schema.user)
	.where(eq(schema.user.email, email))
	.limit(1);

const found = rows[0];
if (!found) {
	console.error(
		`no user with email ${email} — they need to sign in once first`,
	);
	await pool.end();
	process.exit(1);
}

if (found.accessStatus === "approved") {
	console.log(`${found.name} <${email}> is already approved — nothing to do`);
	await pool.end();
	process.exit(0);
}

const { promoted } = await accessServices.promoteUserAccess(db, {
	userId: found.id,
	reviewedBy: `cli:${process.env.USER ?? "beta-approve"}`,
});
await pool.end();

if (!promoted) {
	console.error(`promotion did not apply for ${email} — check the user row`);
	process.exit(1);
}
console.log(`approved: ${found.name} <${email}> is in`);
