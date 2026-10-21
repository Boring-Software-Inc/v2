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
import { user } from "../schema/auth.ts";
import { events } from "../schema/events.ts";
import {
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { runs } from "../schema/runs.ts";
import { touchLastSeen } from "./presence.ts";
import {
	getStaffOverview,
	listInstallationsForStaff,
	listReposForStaff,
	listUsersForStaff,
} from "./staff.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function ago(ms: number): Date {
	return new Date(Date.now() - ms);
}

async function seedUser(
	id: string,
	accessStatus: "pending" | "approved" | "rejected",
	lastSeenAt: Date | null = null,
): Promise<void> {
	await db.insert(user).values({
		id,
		name: id,
		email: `${id}@example.com`,
		accessStatus,
		lastSeenAt,
	});
}

async function seedRepo(opts: {
	fullName: string;
	armed: boolean;
	installationId: string | null;
	removed?: boolean;
	orgId?: string;
}): Promise<void> {
	const [owner = "", name = ""] = opts.fullName.split("/");
	await db.insert(repos).values({
		id: generateId(),
		externalId: generateId(),
		owner,
		name,
		fullName: opts.fullName,
		armed: opts.armed,
		installationId: opts.installationId,
		removedAt: opts.removed ? ago(DAY) : null,
		orgId: opts.orgId ?? null,
	});
}

async function seedRun(opts: {
	repoFullName: string;
	subjectNumber: number;
	verdict: "pass" | "block";
	createdAt: Date;
}): Promise<void> {
	const eventId = generateId();
	await db.insert(events).values({
		id: eventId,
		deliveryId: `d-${eventId}`,
		rawKind: "pull_request",
		raw: {},
	});
	await db.insert(runs).values({
		id: generateId(),
		eventId,
		repoFullName: opts.repoFullName,
		subjectNumber: opts.subjectNumber,
		status: "completed",
		verdict: opts.verdict,
		workflowSnapshot: [],
		createdAt: opts.createdAt,
	});
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);

	await seedUser("ada", "approved", ago(MINUTE));
	await seedUser("bo", "approved", ago(3 * 60 * MINUTE));
	await seedUser("cy", "pending", ago(2 * DAY));
	await seedUser("di", "rejected");

	const teamOrg = generateId();
	await db.insert(organization).values([
		{ id: teamOrg, name: "acme", slug: "acme", isPersonal: false },
		{ id: generateId(), name: "ada", slug: "ada", isPersonal: true },
		{ id: generateId(), name: "bo", slug: "bo", isPersonal: true },
	]);
	await db.insert(organizationInstallations).values([
		{
			id: generateId(),
			organizationId: teamOrg,
			installationId: "100",
			accountLogin: "acme",
			accountType: "Organization",
		},
		{
			id: generateId(),
			organizationId: teamOrg,
			installationId: "101",
			accountLogin: "acme-labs",
			accountType: "Organization",
		},
	]);

	await seedRepo({
		fullName: "acme/api",
		armed: true,
		installationId: "100",
		orgId: teamOrg,
	});
	await seedRepo({
		fullName: "acme/web",
		armed: false,
		installationId: "100",
		orgId: teamOrg,
	});
	await seedRepo({
		fullName: "acme/old",
		armed: true,
		installationId: "100",
		removed: true,
	});
	await seedRepo({ fullName: "solo/cli", armed: true, installationId: "200" });
	await seedRepo({
		fullName: "gone/lib",
		armed: true,
		installationId: "300",
		removed: true,
	});

	await seedRun({
		repoFullName: "acme/api",
		subjectNumber: 1,
		verdict: "block",
		createdAt: ago(MINUTE),
	});
	await seedRun({
		repoFullName: "acme/api",
		subjectNumber: 1,
		verdict: "block",
		createdAt: ago(2 * MINUTE),
	});
	await seedRun({
		repoFullName: "acme/api",
		subjectNumber: 2,
		verdict: "pass",
		createdAt: ago(MINUTE),
	});
	await seedRun({
		repoFullName: "solo/cli",
		subjectNumber: 3,
		verdict: "block",
		createdAt: ago(2 * DAY),
	});
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("getStaffOverview", () => {
	test("protected repos count only live repos with Tripwire on", async () => {
		const overview = await getStaffOverview(db);
		expect(overview.repos).toBe(3);
		expect(overview.protectedRepos).toBe(2);
	});

	test("installations merge claimed rows with live repo installs", async () => {
		const overview = await getStaffOverview(db);
		expect(overview.installations).toBe(3);
	});

	test("users total and the access split", async () => {
		const overview = await getStaffOverview(db);
		expect(overview.totalUsers).toBe(4);
		expect(overview.approvedUsers).toBe(2);
		expect(overview.pendingUsers).toBe(1);
		expect(overview.rejectedUsers).toBe(1);
	});

	test("orgs split into team and personal", async () => {
		const overview = await getStaffOverview(db);
		expect(overview.orgs).toBe(3);
		expect(overview.teamOrgs).toBe(1);
		expect(overview.personalOrgs).toBe(2);
	});

	test("online now covers five minutes and active today covers a day", async () => {
		const overview = await getStaffOverview(db);
		expect(overview.onlineUsers).toBe(1);
		expect(overview.activeUsersToday).toBe(2);
	});

	test("runs and blocked change requests cover the last day", async () => {
		const overview = await getStaffOverview(db);
		expect(overview.runsLastDay).toBe(3);
		expect(overview.blockedChangeRequestsLastDay).toBe(1);
	});
});

describe("staff drill-down lists", () => {
	test("repos list skips removed repos and filters by protection", async () => {
		const all = await listReposForStaff(db, {});
		expect(all.total).toBe(3);
		expect(all.repos.map((r) => r.fullName).sort()).toEqual([
			"acme/api",
			"acme/web",
			"solo/cli",
		]);

		const protectedOnly = await listReposForStaff(db, { status: "protected" });
		expect(protectedOnly.total).toBe(2);
		expect(protectedOnly.repos.every((r) => r.protected)).toBe(true);

		const off = await listReposForStaff(db, { status: "unprotected" });
		expect(off.repos.map((r) => r.fullName)).toEqual(["acme/web"]);

		const api = all.repos.find((r) => r.fullName === "acme/api");
		expect(api?.orgSlug).toBe("acme");
		const solo = all.repos.find((r) => r.fullName === "solo/cli");
		expect(solo?.orgSlug).toBeNull();
	});

	test("installations list claimed and unclaimed installs with repo counts", async () => {
		const list = await listInstallationsForStaff(db, {});
		expect(list.total).toBe(3);
		const byId = new Map(
			list.installations.map((row) => [row.installationId, row]),
		);

		expect(byId.get("100")).toMatchObject({
			forge: "github",
			accountLogin: "acme",
			orgSlug: "acme",
			repoCount: 2,
			protectedRepoCount: 1,
		});
		expect(byId.get("101")).toMatchObject({
			accountLogin: "acme-labs",
			orgSlug: "acme",
			repoCount: 0,
			protectedRepoCount: 0,
		});
		expect(byId.get("200")).toMatchObject({
			accountLogin: "solo",
			orgName: null,
			orgSlug: null,
			repoCount: 1,
			protectedRepoCount: 1,
		});
		expect(byId.has("300")).toBe(false);
	});

	test("users list narrows to users seen in the last five minutes", async () => {
		const online = await listUsersForStaff(db, { online: true });
		expect(online.total).toBe(1);
		expect(online.users[0]?.id).toBe("ada");
		expect(online.users[0]?.lastSeenAt).toBeInstanceOf(Date);

		const everyone = await listUsersForStaff(db, {});
		expect(everyone.total).toBe(4);
	});
});

describe("touchLastSeen", () => {
	async function lastSeen(id: string): Promise<Date | null> {
		const rows = await db
			.select({ lastSeenAt: user.lastSeenAt })
			.from(user)
			.where(eq(user.id, id));
		return rows[0]?.lastSeenAt ?? null;
	}

	test("writes at most once per user per minute", async () => {
		await seedUser("eve", "approved");
		const first = new Date("2020-01-01T12:00:00Z");

		expect(await touchLastSeen(db, "eve", first)).toEqual({ touched: true });
		expect(await lastSeen("eve")).toEqual(first);

		const inside = new Date(first.getTime() + 30_000);
		expect(await touchLastSeen(db, "eve", inside)).toEqual({ touched: false });
		expect(await lastSeen("eve")).toEqual(first);

		const outside = new Date(first.getTime() + 61_000);
		expect(await touchLastSeen(db, "eve", outside)).toEqual({ touched: true });
		expect(await lastSeen("eve")).toEqual(outside);
	});

	test("an unknown user is a no-op", async () => {
		expect(await touchLastSeen(db, "nobody")).toEqual({ touched: false });
	});
});
