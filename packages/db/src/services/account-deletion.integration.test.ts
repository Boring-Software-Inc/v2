import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { forgeIdentities, session, user } from "../schema/auth.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { deviceCode } from "../schema/oauth.ts";
import {
	member,
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { runs } from "../schema/runs.ts";
import {
	AccountDeletionBlockedError,
	countPendingReviews,
	DELETED_ACCOUNT_ACTOR,
	deleteUserAccount,
	listOnRepos,
	listOrgInstallations,
	listSoleAdminOrgs,
} from "./account-deletion.ts";
import { ensurePersonalOrg } from "./organizations.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

async function seedUser(id: string): Promise<string> {
	await db.insert(user).values({ id, name: id, email: `${id}@example.com` });
	return (await ensurePersonalOrg(db, { userId: id, name: id })).id;
}

async function seedTeamOrg(
	slug: string,
	members: { userId: string; role: string }[],
): Promise<string> {
	const orgId = generateId();
	await db
		.insert(organization)
		.values({ id: orgId, name: slug, slug, isPersonal: false });
	for (const entry of members) {
		await db.insert(member).values({
			id: generateId(),
			organizationId: orgId,
			userId: entry.userId,
			role: entry.role,
		});
	}
	return orgId;
}

async function seedRepo(
	orgId: string,
	fullName: string,
	armed: boolean,
): Promise<string> {
	const id = generateId();
	const [owner = "o", name = "r"] = fullName.split("/");
	await db.insert(repos).values({
		id,
		externalId: id,
		owner,
		name,
		fullName,
		armed,
		orgId,
		installationId: `inst-${orgId}`,
	});
	return id;
}

async function seedReview(input: {
	repoFullName: string;
	status: string;
	decidedBy: string | null;
	triggeredBy: string | null;
}): Promise<{ runId: string; itemId: string }> {
	const eventId = generateId();
	await db.insert(events).values({
		id: eventId,
		deliveryId: eventId,
		rawKind: "pull_request",
		raw: {},
	});
	const runId = generateId();
	await db.insert(runs).values({
		id: runId,
		eventId,
		repoFullName: input.repoFullName,
		workflowSnapshot: {},
		triggeredBy: input.triggeredBy,
	});
	const itemId = generateId();
	await db.insert(moderationItems).values({
		id: itemId,
		runId,
		nodeId: "review",
		status: input.status,
		decidedBy: input.decidedBy,
	});
	return { runId, itemId };
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("account deletion", () => {
	test("the only admin of a team org is blocked, and nothing is deleted", async () => {
		await seedUser("solo");
		await seedUser("helper");
		await seedTeamOrg("solo-team", [
			{ userId: "solo", role: "admin" },
			{ userId: "helper", role: "member" },
		]);

		const sole = await listSoleAdminOrgs(db, "solo");
		expect(sole.map((org) => org.slug)).toEqual(["solo-team"]);
		expect(sole[0]?.members).toBe(2);

		expect(deleteUserAccount(db, "solo")).rejects.toBeInstanceOf(
			AccountDeletionBlockedError,
		);
		const still = await db.select().from(user).where(eq(user.id, "solo"));
		expect(still).toHaveLength(1);
	});

	test("a second admin lifts the block", async () => {
		await seedUser("pair-a");
		await seedUser("pair-b");
		await seedTeamOrg("pair-team", [
			{ userId: "pair-a", role: "admin" },
			{ userId: "pair-b", role: "admin" },
		]);
		expect(await listSoleAdminOrgs(db, "pair-a")).toEqual([]);
	});

	test("a plain member is never a blocker", async () => {
		await seedUser("boss");
		await seedUser("plain");
		await seedTeamOrg("plain-team", [
			{ userId: "boss", role: "admin" },
			{ userId: "plain", role: "member" },
		]);
		expect(await listSoleAdminOrgs(db, "plain")).toEqual([]);
	});

	test("reads what the personal org holds", async () => {
		const personal = await seedUser("reader");
		await seedRepo(personal, "reader/on", true);
		await seedRepo(personal, "reader/off", false);
		await db.insert(organizationInstallations).values({
			id: generateId(),
			organizationId: personal,
			installationId: "inst-reader",
			accountType: "User",
			accountLogin: "reader",
		});
		await seedReview({
			repoFullName: "reader/on",
			status: "pending",
			decidedBy: null,
			triggeredBy: null,
		});

		const on = await listOnRepos(db, [personal]);
		expect(on.map((repo) => repo.fullName)).toEqual(["reader/on"]);
		const installs = await listOrgInstallations(db, [personal]);
		expect(installs).toEqual([
			{
				forge: "github",
				installationId: "inst-reader",
				accountLogin: "reader",
				accountType: "User",
			},
		]);
		expect(await countPendingReviews(db, [personal])).toBe(1);
	});

	test("deleting keeps org history and leaves no orphans", async () => {
		const personal = await seedUser("leaver");
		await seedUser("keeper");
		await seedUser("waitlisted");
		await db
			.update(user)
			.set({ accessReviewedBy: "leaver" })
			.where(eq(user.id, "waitlisted"));
		const team = await seedTeamOrg("kept-team", [
			{ userId: "keeper", role: "admin" },
			{ userId: "leaver", role: "member" },
		]);
		const teamRepo = await seedRepo(team, "kept/app", true);
		const personalRepo = await seedRepo(personal, "leaver/app", true);
		await db.insert(organizationInstallations).values({
			id: generateId(),
			organizationId: personal,
			installationId: "inst-leaver",
		});
		const decided = await seedReview({
			repoFullName: "kept/app",
			status: "approved",
			decidedBy: "leaver",
			triggeredBy: "leaver",
		});
		await db.insert(forgeIdentities).values({
			id: generateId(),
			userId: "leaver",
			externalId: "gh-leaver",
			username: "leaver",
		});
		const ownSession = generateId();
		await db.insert(session).values({
			id: ownSession,
			userId: "leaver",
			token: ownSession,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const impersonated = generateId();
		await db.insert(session).values({
			id: impersonated,
			userId: "keeper",
			token: impersonated,
			expiresAt: new Date(Date.now() + 60_000),
			impersonatedBy: "leaver",
		});
		await db.insert(deviceCode).values({
			id: generateId(),
			deviceCode: generateId(),
			userCode: "LEAVER-1",
			userId: "leaver",
			expiresAt: new Date(Date.now() + 60_000),
			status: "approved",
		});

		const result = await deleteUserAccount(db, "leaver");
		expect(result).toEqual({ deleted: true, personalOrgs: 1, reposRemoved: 1 });

		expect(await db.select().from(user).where(eq(user.id, "leaver"))).toEqual(
			[],
		);
		expect(
			await db.select().from(organization).where(eq(organization.id, personal)),
		).toEqual([]);
		expect(
			await db
				.select()
				.from(organizationInstallations)
				.where(eq(organizationInstallations.organizationId, personal)),
		).toEqual([]);
		const [gone] = await db
			.select()
			.from(repos)
			.where(eq(repos.id, personalRepo));
		expect(gone?.orgId).toBeNull();
		expect(gone?.removedAt).not.toBeNull();
		const [kept] = await db.select().from(repos).where(eq(repos.id, teamRepo));
		expect(kept?.orgId).toBe(team);
		expect(kept?.armed).toBe(true);

		const [item] = await db
			.select()
			.from(moderationItems)
			.where(eq(moderationItems.id, decided.itemId));
		expect(item?.status).toBe("approved");
		expect(item?.decidedBy).toBeNull();
		const [run] = await db
			.select()
			.from(runs)
			.where(eq(runs.id, decided.runId));
		expect(run?.triggeredBy).toBe(DELETED_ACCOUNT_ACTOR);

		const [reviewed] = await db
			.select()
			.from(user)
			.where(eq(user.id, "waitlisted"));
		expect(reviewed?.accessReviewedBy).toBeNull();
		expect(
			await db.select().from(session).where(eq(session.id, impersonated)),
		).toEqual([]);
		expect(
			await db.select().from(session).where(eq(session.userId, "leaver")),
		).toEqual([]);
		expect(
			await db.select().from(deviceCode).where(eq(deviceCode.userId, "leaver")),
		).toEqual([]);
		expect(
			await db
				.select()
				.from(forgeIdentities)
				.where(eq(forgeIdentities.userId, "leaver")),
		).toEqual([]);
		expect(
			await db.select().from(member).where(eq(member.userId, "leaver")),
		).toEqual([]);
		const teamMembers = await db
			.select()
			.from(member)
			.where(eq(member.organizationId, team));
		expect(teamMembers.map((row) => row.userId)).toEqual(["keeper"]);
	});

	test("deleting an account that is already gone is a no-op", async () => {
		expect(await deleteUserAccount(db, "nobody")).toEqual({
			deleted: false,
			personalOrgs: 0,
			reposRemoved: 0,
		});
	});
});
