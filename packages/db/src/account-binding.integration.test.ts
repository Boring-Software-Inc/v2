import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { generateId } from "@tripwire/utils";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./client.ts";
import { applyMigrations } from "./migrate.ts";
import { account, user } from "./schema/auth.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	/** Restore 0044 so the OIDC index can be staged without the 0045 ingest change. */
	await db.transaction(async (tx) => {
		await tx.execute(sql`DROP INDEX account_gitcafe_subject_unique`);
		await tx.execute(sql`DROP INDEX events_forge_delivery_id_unique`);
		await tx.execute(
			sql`CREATE UNIQUE INDEX events_delivery_id_unique ON events (delivery_id)`,
		);
		await tx.execute(sql`
			DELETE FROM drizzle.__drizzle_migrations
			WHERE id IN (SELECT id FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2)
		`);
	});
}, 120_000);

afterAll(async () => {
	await pool?.end();
	await container?.stop();
});

test("0046 upgrades existing installs and fails closed on ambiguous GitCafe owners only", async () => {
	const ddl = await readFile(
		new URL("../drizzle/0046_gitcafe_account_binding.sql", import.meta.url),
		"utf8",
	);
	const subject = generateId();
	const ownerId = generateId();
	const otherId = generateId();
	await db.insert(user).values(
		[ownerId, otherId].map((id) => ({
			id,
			email: `${id}@example.test`,
			name: "Migration owner",
		})),
	);
	const rows = ["gitcafe", "github", "opengit"].flatMap((providerId) =>
		[ownerId, otherId].map((userId) => ({
			id: generateId(),
			userId,
			providerId,
			accountId: subject,
		})),
	);
	await db.insert(account).values(rows);
	await expect(db.execute(sql.raw(ddl)).execute()).rejects.toThrow();
	await expect(applyMigrations(db)).rejects.toThrow();
	expect(await db.select().from(account)).toHaveLength(6);
	const duplicate = rows.find(
		(row) => row.providerId === "gitcafe" && row.userId === otherId,
	);
	if (!duplicate) {
		throw new Error("Missing migration test duplicate");
	}
	await db.delete(account).where(eq(account.id, duplicate.id));
	await db.execute(sql.raw(ddl));
	await db.execute(sql.raw(ddl));
	const indexCheck = await db.execute(sql`
		SELECT
			i.indisunique AND i.indisvalid AND i.indisready
			AND i.indrelid = 'public.account'::regclass
			AND am.amname = 'btree'
			AND i.indnkeyatts = 2 AND i.indnatts = 2
			AND pg_get_indexdef(i.indexrelid, 1, true) = 'provider_id'
			AND pg_get_indexdef(i.indexrelid, 2, true) = 'account_id'
			AND pg_get_expr(i.indpred, i.indrelid) = '(provider_id = ''gitcafe''::text)'
			AS equivalent
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indexrelid
		JOIN pg_am am ON am.oid = c.relam
		WHERE i.indexrelid = to_regclass('public.account_gitcafe_subject_unique')
	`);
	expect(indexCheck.rows).toEqual([{ equivalent: true }]);
	expect(
		(await db.execute(sql`SELECT id FROM drizzle.__drizzle_migrations`)).rows,
	).toHaveLength(45);
	expect(
		(
			await db.execute(
				sql`SELECT indexname FROM pg_indexes WHERE indexname = 'events_delivery_id_unique'`,
			)
		).rows,
	).toHaveLength(1);
	expect(
		(
			await db.execute(
				sql`SELECT indexname FROM pg_indexes WHERE indexname = 'events_forge_delivery_id_unique'`,
			)
		).rows,
	).toHaveLength(0);
	await applyMigrations(db);
	await applyMigrations(db);
	const migrated = await db.select().from(account);
	expect(migrated).toHaveLength(5);
	for (const row of rows.filter((row) => row.id !== duplicate.id)) {
		expect(migrated).toContainEqual(expect.objectContaining(row));
	}
	for (const providerId of ["github", "opengit"]) {
		await db.insert(account).values({
			id: generateId(),
			userId: otherId,
			providerId,
			accountId: subject,
		});
	}
	await expect(
		db
			.insert(account)
			.values({
				id: generateId(),
				userId: otherId,
				providerId: "gitcafe",
				accountId: subject,
			})
			.execute(),
	).rejects.toThrow();
	expect(
		await db
			.select()
			.from(account)
			.where(
				and(eq(account.providerId, "gitcafe"), eq(account.accountId, subject)),
			),
	).toMatchObject([{ userId: ownerId }]);
});
