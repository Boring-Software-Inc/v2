import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { forgeIdentities, user } from "../schema/auth.ts";
import {
	claimInstallationForForgeUser,
	getActiveRepo,
	getOnboardingState,
	linkUserInstallation,
	listUserRepos,
	setActiveRepo,
} from "./onboarding.ts";
import { syncInstallationRepos } from "./repos.ts";

/**
 * §10 onboarding — the user ↔ installation ↔ active-repo links. An installation
 * belongs to exactly one user; the active repo must be one the user's
 * installation actually grants.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

async function seedUser(id: string): Promise<void> {
	await db.insert(user).values({ id, name: id, email: `${id}@example.com` });
}

async function seedRepo(
	installationId: string,
	externalId: string,
	fullName: string,
): Promise<void> {
	const [owner, name] = fullName.split("/");
	await syncInstallationRepos(
		db,
		installationId,
		[
			{
				externalId,
				owner: owner ?? fullName,
				name: name ?? fullName,
				fullName,
				private: false,
			},
		],
		[],
	);
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("onboarding links", () => {
	test("link → list granted repos → pick active", async () => {
		await seedUser("u-1");
		await seedRepo("inst-1", "r-1", "acme/one");
		await seedRepo("inst-1", "r-2", "acme/two");

		const { claimed } = await linkUserInstallation(db, {
			userId: "u-1",
			installationId: "inst-1",
		});
		expect(claimed).toBe(true);

		const repos = await listUserRepos(db, "u-1");
		expect(repos.map((r) => r.fullName).sort()).toEqual([
			"acme/one",
			"acme/two",
		]);

		const state = await getOnboardingState(db, "u-1");
		expect(state.hasInstallation).toBe(true);
		expect(state.activeRepo).toBeNull();

		const picked = repos.find((r) => r.fullName === "acme/two");
		if (!picked) {
			throw new Error("expected acme/two");
		}
		expect(await setActiveRepo(db, "u-1", picked.id)).toBe(true);
		expect((await getActiveRepo(db, "u-1"))?.fullName).toBe("acme/two");
	});

	test("an installation belongs to exactly one user — no stealing", async () => {
		await seedUser("u-2");
		// u-1 already owns inst-1; u-2 trying to claim it is a no-op.
		const { claimed } = await linkUserInstallation(db, {
			userId: "u-2",
			installationId: "inst-1",
		});
		expect(claimed).toBe(false);
		expect(await listUserRepos(db, "u-2")).toHaveLength(0);
	});

	test("active repo must be one the user actually has", async () => {
		await seedUser("u-3");
		await seedRepo("inst-3", "r-3", "other/repo");
		await linkUserInstallation(db, {
			userId: "u-3",
			installationId: "inst-3",
		});
		// A repo from someone else's installation (acme/one → u-1) is refused.
		const foreign = (await listUserRepos(db, "u-1"))[0];
		if (!foreign) {
			throw new Error("expected u-1 repo");
		}
		expect(await setActiveRepo(db, "u-3", foreign.id)).toBe(false);
		expect(await getActiveRepo(db, "u-3")).toBeNull();
	});
});

describe("claimInstallationForForgeUser — the durable webhook link path", () => {
	async function seedIdentity(
		userId: string,
		externalId: string,
	): Promise<void> {
		await db
			.insert(forgeIdentities)
			.values({
				id: `fi-${userId}`,
				userId,
				forge: "github",
				externalId,
				username: userId,
			})
			.onConflictDoNothing();
	}

	test("links the installer (matched by forge id) → repos granted", async () => {
		await seedUser("u-installer");
		await seedIdentity("u-installer", "gh-9001");
		await seedRepo("inst-webhook", "r-w", "acme/webhook");

		const result = await claimInstallationForForgeUser(db, {
			installerExternalId: "gh-9001",
			installationId: "inst-webhook",
		});
		expect(result).toEqual({ claimed: true, userId: "u-installer" });

		const state = await getOnboardingState(db, "u-installer");
		expect(state.hasInstallation).toBe(true);
		expect(state.repos.map((r) => r.fullName)).toEqual(["acme/webhook"]);
	});

	test("installer with no forge identity yet ⇒ no-op, deferred to setup callback", async () => {
		await seedRepo("inst-orphan", "r-o", "acme/orphan");
		const result = await claimInstallationForForgeUser(db, {
			installerExternalId: "gh-unknown",
			installationId: "inst-orphan",
		});
		expect(result).toEqual({ claimed: false, userId: null });
	});
});
