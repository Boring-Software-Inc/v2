/**
 * Grant or revoke the platform staff role by email.
 *
 *   bun run grant-admin someone@example.com
 *   bun run grant-admin someone@example.com --revoke
 *
 * `isPlatformAdmin` is `input: false` in Better Auth — no client payload and
 * no server fn (including the /admin portal itself) can set it. This script
 * is THE write path: the portal must not be able to mint its own gate's
 * privilege. Prints before/after; the shell history is the audit trail (see
 * DECISIONS.md — revisit before the first non-founder staff grant). The gate
 * reads the bit fresh per request, so grant and revocation are instant.
 */
import { createDb, schema } from "@tripwire/db";
import { eq } from "drizzle-orm";

const email = process.argv[2]?.trim().toLowerCase();
const revoke = process.argv.includes("--revoke");
if (!email || !email.includes("@")) {
	console.error("usage: bun run grant-admin <email> [--revoke]");
	process.exit(1);
}

const { db, pool } = createDb();

const rows = await db
	.select({
		id: schema.user.id,
		name: schema.user.name,
		isPlatformAdmin: schema.user.isPlatformAdmin,
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

const target = !revoke;
if (found.isPlatformAdmin === target) {
	console.log(
		`${found.name} <${email}> is already ${target ? "staff" : "not staff"} — nothing to do`,
	);
	await pool.end();
	process.exit(0);
}

await db
	.update(schema.user)
	.set({ isPlatformAdmin: target })
	.where(eq(schema.user.id, found.id));
await pool.end();

console.log(
	`${found.name} <${email}>: staff ${found.isPlatformAdmin} -> ${target}`,
);
