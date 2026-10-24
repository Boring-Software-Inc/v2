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
import { account, forgeIdentities, session, user } from "../schema/auth.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import {
	agentGrants,
	deviceCode,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
} from "../schema/oauth.ts";
import { member, organization } from "../schema/organizations.ts";
import { runSteps, runs } from "../schema/runs.ts";
import { promoteUserAccess } from "./access.ts";
import { getAgentGrant, saveAgentGrant } from "./agents.ts";
import { listStaffAuditForUser, recordStaffAudit } from "./staff-audit.ts";
import {
	banUser,
	getSessionGuardState,
	getSessionImpersonator,
	getStaffUserDetail,
	isUserBanned,
	listContributorRuns,
	listModerationDecisionsBy,
	listUserSessions,
	recordDatabuddyAnonId,
	revokeAllUserSessions,
	revokeUserSession,
	setPlatformAdmin,
	unbanUser,
} from "./staff-users.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const HOUR = 60 * 60 * 1000;

async function seedUser(name: string): Promise<string> {
	const id = generateId();
	await db.insert(user).values({ id, name, email: `${name}@example.com` });
	return id;
}

async function seedSession(
	userId: string,
	opts: { impersonatedBy?: string; expiresIn?: number } = {},
): Promise<string> {
	const id = generateId();
	await db.insert(session).values({
		id,
		userId,
		token: generateId(),
		expiresAt: new Date(Date.now() + (opts.expiresIn ?? HOUR)),
		userAgent: "Mozilla/5.0 (Macintosh) Chrome/130",
		ipAddress: "102.89.34.7",
		impersonatedBy: opts.impersonatedBy ?? null,
	});
	return id;
}

async function seedAgent(userId: string): Promise<string> {
	const clientId = `client-${generateId()}`;
	await db.insert(oauthClient).values({
		id: generateId(),
		clientId,
		name: "Claude Code",
		redirectUris: ["http://127.0.0.1:7777/callback"],
	});
	await saveAgentGrant(db, { userId, clientId, orgIds: [] });
	const refreshId = generateId();
	await db.insert(oauthRefreshToken).values({
		id: refreshId,
		token: generateId(),
		clientId,
		userId,
		scopes: ["tripwire:read"],
	});
	await db.insert(oauthAccessToken).values({
		id: generateId(),
		token: generateId(),
		clientId,
		userId,
		refreshId,
		scopes: ["tripwire:read"],
	});
	await db.insert(oauthConsent).values({
		id: generateId(),
		clientId,
		userId,
		scopes: ["tripwire:read"],
	});
	await db.insert(deviceCode).values({
		id: generateId(),
		deviceCode: generateId(),
		userCode: generateId(),
		userId,
		clientId,
		status: "approved",
		expiresAt: new Date(Date.now() + HOUR),
	});
	return clientId;
}

async function credentialCounts(userId: string) {
	const count = async (rows: Promise<unknown[]>) => (await rows).length;
	return {
		grants: await count(
			db.select().from(agentGrants).where(eq(agentGrants.userId, userId)),
		),
		access: await count(
			db
				.select()
				.from(oauthAccessToken)
				.where(eq(oauthAccessToken.userId, userId)),
		),
		refresh: await count(
			db
				.select()
				.from(oauthRefreshToken)
				.where(eq(oauthRefreshToken.userId, userId)),
		),
		consents: await count(
			db.select().from(oauthConsent).where(eq(oauthConsent.userId, userId)),
		),
		deviceCodes: await count(
			db.select().from(deviceCode).where(eq(deviceCode.userId, userId)),
		),
	};
}

async function seedRun(opts: {
	login: string;
	repo: string;
	number: number;
	verdict: "pass" | "block" | "needs_review";
	failedRule?: string;
}): Promise<string> {
	const eventId = generateId();
	await db.insert(events).values({
		id: eventId,
		deliveryId: `d-${eventId}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.opened",
		actorLogin: opts.login,
	});
	const runId = generateId();
	await db.insert(runs).values({
		id: runId,
		eventId,
		repoFullName: opts.repo,
		subjectNumber: opts.number,
		status: "completed",
		verdict: opts.verdict,
		workflowSnapshot: [],
	});
	if (opts.failedRule) {
		const now = new Date();
		await db.insert(runSteps).values({
			id: generateId(),
			runId,
			nodeId: "n1",
			nodeKind: "rule",
			ruleId: opts.failedRule,
			status: "fail",
			startedAt: now,
			finishedAt: now,
			durationMs: 1,
		});
	}
	return runId;
}

let staff: string;
let mara: string;

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
	staff = await seedUser("grim");
	mara = await seedUser("Mara Okafor");
	await db.insert(forgeIdentities).values({
		id: generateId(),
		userId: mara,
		forge: "github",
		externalId: "4242",
		username: "MaraOkafor",
	});
	await db.insert(account).values({
		id: generateId(),
		userId: mara,
		accountId: "4242",
		providerId: "github",
	});
	const orgId = generateId();
	await db.insert(organization).values({
		id: orgId,
		name: "maraokafor",
		slug: "maraokafor",
		isPersonal: true,
	});
	await db.insert(member).values({
		id: generateId(),
		organizationId: orgId,
		userId: mara,
		role: "admin",
	});
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("getStaffUserDetail", () => {
	test("joins the reviewer, login, personal org and sign-in providers", async () => {
		await promoteUserAccess(db, { userId: mara, reviewedBy: staff });
		const detail = await getStaffUserDetail(db, mara);
		expect(detail).toMatchObject({
			name: "Mara Okafor",
			login: "MaraOkafor",
			accessStatus: "approved",
			reviewedBy: { id: staff, name: "grim" },
			personalOrgSlug: "maraokafor",
			providers: ["github"],
			databuddyAnonId: null,
		});
		expect(await getStaffUserDetail(db, "nobody")).toBeNull();
	});
});

describe("sessions", () => {
	test("lists live sessions and signs out one or all", async () => {
		const a = await seedSession(mara);
		await seedSession(mara);
		await seedSession(mara, { expiresIn: -HOUR });
		expect((await listUserSessions(db, mara)).map((s) => s.id)).toContain(a);
		expect(await listUserSessions(db, mara)).toHaveLength(2);
		expect(await revokeUserSession(db, { userId: staff, sessionId: a })).toBe(
			false,
		);
		expect(await revokeUserSession(db, { userId: mara, sessionId: a })).toBe(
			true,
		);
		expect(await revokeAllUserSessions(db, mara)).toBe(2);
		expect(await listUserSessions(db, mara)).toHaveLength(0);
	});

	test("an impersonation session names who started it", async () => {
		const id = await seedSession(mara, { impersonatedBy: staff });
		expect(await getSessionImpersonator(db, id)).toBe(staff);
		expect(
			await getSessionGuardState(db, { userId: mara, sessionId: id }),
		).toEqual({ banned: false, impersonatedBy: staff });
		expect(
			await getSessionGuardState(db, { userId: staff, sessionId: id }),
		).toEqual({ banned: false, impersonatedBy: null });
		const own = await seedSession(mara);
		expect(await getSessionImpersonator(db, own)).toBeNull();
		await revokeAllUserSessions(db, mara);
	});
});

describe("ban", () => {
	test("bans with a reason and end date, ends sessions, and unbans", async () => {
		const spammer = await seedUser("spammer");
		await seedSession(spammer);
		const ends = new Date(Date.now() + 24 * HOUR);
		const result = await banUser(db, {
			userId: spammer,
			reason: "Opened 30 change requests with copied code in one hour",
			expires: ends,
		});
		expect(result).toEqual({ banned: true, sessionsEnded: 1 });
		expect(await isUserBanned(db, spammer)).toBe(true);
		expect(
			await isUserBanned(db, spammer, new Date(ends.getTime() + HOUR)),
		).toBe(false);
		const detail = await getStaffUserDetail(db, spammer);
		expect(detail?.banReason).toContain("copied code");
		expect((await unbanUser(db, spammer)).changed).toBe(true);
		expect(await isUserBanned(db, spammer)).toBe(false);
		expect((await unbanUser(db, spammer)).changed).toBe(false);
	});

	test("a ban ends every agent credential: grants, tokens, consents and device codes", async () => {
		const agentUser = await seedUser("agent-user");
		const clientId = await seedAgent(agentUser);
		const bystander = await seedUser("bystander");
		await seedAgent(bystander);
		await banUser(db, { userId: agentUser, reason: "Abuse", expires: null });
		expect(await credentialCounts(agentUser)).toEqual({
			grants: 0,
			access: 0,
			refresh: 0,
			consents: 0,
			deviceCodes: 0,
		});
		expect(await credentialCounts(bystander)).toEqual({
			grants: 1,
			access: 1,
			refresh: 1,
			consents: 1,
			deviceCodes: 1,
		});
		await saveAgentGrant(db, { userId: agentUser, clientId, orgIds: [] });
		expect(await getAgentGrant(db, { userId: agentUser, clientId })).toBeNull();
		await unbanUser(db, agentUser);
		expect(
			await getAgentGrant(db, { userId: agentUser, clientId }),
		).not.toBeNull();
	});

	test("a ban with no end date holds forever", async () => {
		const forever = await seedUser("forever");
		await banUser(db, { userId: forever, reason: "Abuse", expires: null });
		expect(
			await isUserBanned(db, forever, new Date(Date.now() + 1000 * 24 * HOUR)),
		).toBe(true);
	});
});

describe("platform admin and anon id", () => {
	test("flips the staff bit only when it changes", async () => {
		const ops = await seedUser("ops");
		expect(
			(await setPlatformAdmin(db, { userId: ops, isPlatformAdmin: true }))
				.changed,
		).toBe(true);
		expect(
			(await setPlatformAdmin(db, { userId: ops, isPlatformAdmin: true }))
				.changed,
		).toBe(false);
		const rows = await db
			.select({ isPlatformAdmin: user.isPlatformAdmin })
			.from(user)
			.where(eq(user.id, ops));
		expect(rows[0]?.isPlatformAdmin).toBe(true);
	});

	test("stores the last anonymous id with its time", async () => {
		const anon = "anon_4f1c9e2a-7b3d-4e8a-9c1f-2d6b8a0e5f37";
		expect(
			(await recordDatabuddyAnonId(db, { userId: mara, anonId: anon })).changed,
		).toBe(true);
		expect(
			(await recordDatabuddyAnonId(db, { userId: mara, anonId: anon })).changed,
		).toBe(false);
		const detail = await getStaffUserDetail(db, mara);
		expect(detail?.databuddyAnonId).toBe(anon);
		expect(detail?.databuddyAnonIdAt).toBeInstanceOf(Date);
	});
});

describe("moderation", () => {
	test("lists runs against their login, any case, with the blocking rule", async () => {
		const blocked = await seedRun({
			login: "maraokafor",
			repo: "openfield/web",
			number: 88,
			verdict: "block",
			failedRule: "account-age@1",
		});
		const reviewed = await seedRun({
			login: "MARAOKAFOR",
			repo: "openfield/web",
			number: 91,
			verdict: "pass",
		});
		await seedRun({
			login: "someone-else",
			repo: "openfield/web",
			number: 92,
			verdict: "block",
		});
		await db.insert(moderationItems).values({
			id: generateId(),
			runId: reviewed,
			nodeId: "n1",
			status: "approved",
			decidedBy: staff,
			decidedAt: new Date(),
		});
		const { runs: list, total } = await listContributorRuns(db, ["MaraOkafor"]);
		expect(total).toBe(2);
		const byId = new Map(list.map((r) => [r.runId, r]));
		expect(byId.get(blocked)).toMatchObject({
			verdict: "block",
			blockingRuleId: "account-age@1",
			humanReviewed: false,
		});
		expect(byId.get(reviewed)).toMatchObject({
			verdict: "pass",
			humanReviewed: true,
		});
		expect(await listContributorRuns(db, [])).toEqual({ runs: [], total: 0 });

		const decisions = await listModerationDecisionsBy(db, staff);
		expect(decisions.total).toBe(1);
		expect(decisions.items[0]).toMatchObject({
			runId: reviewed,
			status: "approved",
			repoFullName: "openfield/web",
			subjectNumber: 91,
		});
	});
});

describe("staff audit", () => {
	test("records actor, action and detail, newest first", async () => {
		await recordStaffAudit(db, {
			actorId: staff,
			targetUserId: mara,
			action: "flag.override",
			detail: { flagKey: "show-sidebar", from: "default", to: "on" },
		});
		await recordStaffAudit(db, {
			actorId: staff,
			targetUserId: mara,
			action: "impersonation.start",
		});
		const log = await listStaffAuditForUser(db, mara);
		expect(log.map((e) => e.action)).toEqual([
			"impersonation.start",
			"flag.override",
		]);
		expect(log[1]).toMatchObject({
			actorName: "grim",
			detail: { flagKey: "show-sidebar", to: "on" },
		});
	});

	test("refuses a detail that is not flat", async () => {
		await expect(
			recordStaffAudit(db, {
				actorId: staff,
				targetUserId: mara,
				action: "user.ban",
				detail: JSON.parse('{"nested":{"a":1}}'),
			}),
		).rejects.toThrow();
	});
});
