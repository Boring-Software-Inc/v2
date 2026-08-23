import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import {
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import {
	countUnclaimedRepos,
	ensureRepo,
	removeInstallation,
} from "./repos.ts";

/**
 * Re-importing a DISCONNECTED repo. Disconnecting soft-removes the row and
 * leaves `org_id` pointing at the org that dropped it; `ensureRepo` used to see
 * "row exists" and return early, so the repo could never come back — the import
 * reported success while nothing listed it and the claim screen had nothing to
 * offer. This pins the revive.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const FULL_NAME = "vys69/tripwire";
const ACCOUNT = "22514186";
const OLD_ORG = "019f923d-f127-71b4-a860-85260b2db04c";

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);
afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

function importProject() {
	return ensureRepo(db, {
		forge: "github",
		externalId: "1",
		owner: "vys69",
		name: "tripwire",
		fullName: FULL_NAME,
		private: false,
		installationId: ACCOUNT,
		orgId: null,
	});
}

async function read() {
	const rows = await db
		.select()
		.from(repos)
		.where(and(eq(repos.forge, "github"), eq(repos.fullName, FULL_NAME)));
	return rows[0];
}

test("re-import revives a disconnected repo and releases its old org", async () => {
	const id = await importProject();

	// Disconnect: soft-remove, but the org binding stays (history keeps it).
	await db
		.update(repos)
		.set({ removedAt: new Date(), orgId: OLD_ORG })
		.where(eq(repos.id, id));
	expect(await countUnclaimedRepos(db, "github", ACCOUNT)).toBe(0);

	const again = await importProject();

	expect(again).toBe(id); // same row, not a duplicate
	const row = await read();
	expect(row?.removedAt).toBeNull(); // visible again
	expect(row?.orgId).toBeNull(); // claimable by whichever org now
	// The claim screen has something to offer, so the connect flow stops
	// reporting "already connected to an org".
	expect(await countUnclaimedRepos(db, "github", ACCOUNT)).toBe(1);
});

test("re-import of a live repo is a no-op and keeps its org", async () => {
	const id = await ensureRepo(db, {
		forge: "github",
		externalId: "2",
		owner: "vys69",
		name: "other",
		fullName: "vys69/other",
		private: false,
		installationId: ACCOUNT,
		orgId: OLD_ORG,
	});
	await importProject(); // unrelated project, should not disturb this one

	const rows = await db.select().from(repos).where(eq(repos.id, id));
	expect(rows[0]?.orgId).toBe(OLD_ORG);
	expect(rows[0]?.removedAt).toBeNull();
});

/**
 * The orphan trap: a disconnect that soft-removes repos but leaves the
 * `organization_installations` row behind produces repos that are unclaimed
 * (`org_id IS NULL`, invisible to every org) AND unclaimable (the claim screen
 * skips any installation that still has an ownership row). Nothing in the UI can
 * reach them again.
 */
test("disconnect drops the ownership row so re-imported repos stay claimable", async () => {
	const id = await ensureRepo(db, {
		forge: "github",
		externalId: "9",
		owner: "vys69",
		name: "orphan",
		fullName: "vys69/orphan",
		private: false,
		installationId: "orphan-acct",
		orgId: null,
	});
	// The ownership row FKs to a real org.
	await db
		.insert(organization)
		.values({ id: OLD_ORG, name: "grim", slug: "grim" })
		.onConflictDoNothing();
	await db.insert(organizationInstallations).values({
		id: "oi-orphan",
		organizationId: OLD_ORG,
		forge: "github",
		installationId: "orphan-acct",
	});
	await db.update(repos).set({ orgId: OLD_ORG }).where(eq(repos.id, id));

	const result = await removeInstallation(db, "github", "orphan-acct");
	expect(result.removedRepos).toBe(1);

	// The ownership pointer must be gone, or the claim screen filters the repo
	// out forever once it is re-imported.
	const claims = await db
		.select()
		.from(organizationInstallations)
		.where(
			and(
				eq(organizationInstallations.forge, "github"),
				eq(organizationInstallations.installationId, "orphan-acct"),
			),
		);
	expect(claims).toHaveLength(0);

	// Re-import revives it as claimable.
	await ensureRepo(db, {
		forge: "github",
		externalId: "9",
		owner: "vys69",
		name: "orphan",
		fullName: "vys69/orphan",
		private: false,
		installationId: "orphan-acct",
		orgId: null,
	});
	expect(await countUnclaimedRepos(db, "github", "orphan-acct")).toBe(1);
});
