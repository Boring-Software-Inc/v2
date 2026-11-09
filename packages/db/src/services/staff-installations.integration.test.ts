import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
} from "../index.ts";
import { applyPgliteMigrations, createPgliteDb } from "../pglite.ts";
import { user } from "../schema/auth.ts";
import {
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { ensureDemoRepo } from "../seed.ts";
import { seedApprovedInstallRequest } from "../seed-extras.ts";
import { getStaffOverview, listInstallationsForStaff } from "./staff.ts";

describe.each([
	"postgres",
	"pglite",
] as const)("staff installations with legacy rows on %s", (driver) => {
	let db: Db;
	let stop: () => Promise<void>;

	beforeAll(async () => {
		if (driver === "postgres") {
			const container = await createTestDatabase();
			const handle = createDb(container.url);
			db = handle.db;
			stop = async () => {
				await handle.pool.end();
				await container.stop();
			};
			await applyMigrations(db);
		} else {
			const handle = createPgliteDb();
			db = handle.db;
			stop = () => handle.client.close();
			await applyPgliteMigrations(handle.client);
		}

		const userId = generateId();
		await db.insert(user).values({
			id: userId,
			name: "Staff seed",
			email: `${userId}@tripwire.demo`,
		});
		await seedApprovedInstallRequest(db, { userId, now: new Date() });
		const orgId = generateId();
		await db.insert(organization).values({
			id: orgId,
			name: "Staff seed",
			slug: "staff-seed",
		});
		await db.insert(organizationInstallations).values(
			["github", "opengit", "gitcafe", "gitlab"].map((forge) => ({
				id: generateId(),
				organizationId: orgId,
				forge,
				installationId: `${forge}-claimed`,
				accountLogin: `${forge}-account`,
			})),
		);
		await ensureDemoRepo(db, "staff-claimed", {
			installationId: "github-claimed",
		});
		const legacy = await ensureDemoRepo(db, "staff-legacy", {
			installationId: "gitlab-repo-only",
		});
		await db.execute(
			sql`UPDATE repos SET forge = 'gitlab' WHERE id = ${legacy.id}`,
		);
		const removed = await ensureDemoRepo(db, "staff-removed", {
			installationId: "github-removed",
		});
		await db
			.update(repos)
			.set({ removedAt: new Date() })
			.where(eq(repos.id, removed.id));
		await ensureDemoRepo(db, "staff-no-installation");
	}, 120_000);

	afterAll(async () => {
		await stop?.();
	});

	test("lists supported claimed and seeded repo-only installs, excluding both legacy sources", async () => {
		const list = await listInstallationsForStaff(db, {});
		expect(list.total).toBe(4);
		expect(list.installations).toEqual([
			...(["gitcafe", "github", "opengit"] as const).map((forge) => ({
				forge,
				installationId: `${forge}-claimed`,
				accountLogin: `${forge}-account`,
				accountType: null,
				orgName: "Staff seed",
				orgSlug: "staff-seed",
				repoCount: forge === "github" ? 1 : 0,
				protectedRepoCount: forge === "github" ? 1 : 0,
			})),
			{
				forge: "github",
				installationId: "demo-inst-pending",
				accountLogin: "tripwire-demo",
				accountType: null,
				orgName: null,
				orgSlug: null,
				repoCount: 2,
				protectedRepoCount: 2,
			},
		]);
	});

	test("pagination totals and overview use the same supported installation set", async () => {
		const first = await listInstallationsForStaff(db, { limit: 2 });
		const second = await listInstallationsForStaff(db, {
			limit: 2,
			offset: 2,
		});
		const beyond = await listInstallationsForStaff(db, { offset: 4 });
		expect([first.total, second.total, beyond.total]).toEqual([4, 4, 4]);
		expect(
			[...first.installations, ...second.installations].map(
				(row) => row.installationId,
			),
		).toEqual([
			"gitcafe-claimed",
			"github-claimed",
			"opengit-claimed",
			"demo-inst-pending",
		]);
		expect(beyond.installations).toEqual([]);
		expect((await getStaffOverview(db)).installations).toBe(4);
	});
});
