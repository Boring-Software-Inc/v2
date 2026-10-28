import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	GITCAFE_CONNECT_QUEUE,
	type GitCafeConnectionJob,
	type GitCafeOrganizationMembers,
	gitCafeConnectionRepositorySchema,
	gitCafeInstallationSchema,
	gitCafeOrganizationMembersSchema,
} from "@tripwire/contracts";
import {
	account,
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	gitCafeConnectionServices,
	member,
	organization,
	organizationInstallations,
	organizationRole,
	orgServices,
	repoServices,
	repos,
	session,
	type TestDatabase,
	user,
	workflowServices,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createGitCafeConnectionBoss } from "../gitcafe-connection-worker.ts";
import {
	connectGitCafeInstallation,
	type GitCafeConnectionDeps,
} from "./gitcafe-connect.ts";

const fixtureBase = new URL(
	"../../../../packages/forge-gitcafe/fixtures/",
	import.meta.url,
);
const installation = gitCafeInstallationSchema.parse(
	await Bun.file(new URL("gitcafe-installation.json", fixtureBase)).json(),
);
const membership = gitCafeOrganizationMembersSchema.parse(
	await Bun.file(
		new URL("gitcafe-connection-members.json", fixtureBase),
	).json(),
);
const repository = gitCafeConnectionRepositorySchema.parse(
	await Bun.file(
		new URL("gitcafe-connection-repository.json", fixtureBase),
	).json(),
);
const actorId = membership.items[0]?.actorId;
if (!actorId) throw new Error("captured staging actor missing");
let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let boss: PgBoss;
let job: GitCafeConnectionJob;
let reads: number;
let lookupCount: number;
let changedLookup: () => typeof installation;
let beforeFetch: () => Promise<void>;
let membersResponse: GitCafeOrganizationMembers;
let repositoryResponse: unknown;
let deps: GitCafeConnectionDeps;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 60_000);

beforeEach(async () => {
	await db.execute(sql`TRUNCATE repos, organization, "user" CASCADE`);
	const userId = generateId(),
		sessionId = generateId(),
		orgId = generateId();
	await db.insert(user).values({
		id: userId,
		name: "Local connection initiator",
		email: `${userId}@example.com`,
		accessStatus: "approved",
	});
	await db.insert(session).values({
		id: sessionId,
		userId,
		token: generateId(),
		expiresAt: new Date(Date.now() + 60_000),
	});
	await db.insert(organization).values({
		id: orgId,
		name: "Connection target",
		slug: `target-${orgId}`,
		isPersonal: false,
	});
	await db
		.insert(member)
		.values({ id: generateId(), userId, organizationId: orgId, role: "admin" });
	const reserveAdmin = generateId();
	await db.insert(user).values({
		id: reserveAdmin,
		name: "Retained org admin",
		email: `${reserveAdmin}@example.com`,
		accessStatus: "approved",
	});
	await db.insert(member).values({
		id: generateId(),
		userId: reserveAdmin,
		organizationId: orgId,
		role: "admin",
	});
	job = {
		userId,
		sessionId,
		orgId,
		installationId: installation.id,
		subject: "separate-delegating-subject",
		actorId: actorId ?? "missing",
		authorizedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
		requestId: generateId(),
	};
	reads = 0;
	lookupCount = 0;
	changedLookup = () => installation;
	beforeFetch = async () => {};
	membersResponse = membership;
	repositoryResponse = repository;
	deps = {
		db,
		client: {
			getInstallation: async () => {
				lookupCount++;
				return { ok: true, value: changedLookup() };
			},
			getToken: async () => ({ ok: true, value: "test-transport-credential" }),
		},
		fetch: async (input) => {
			reads++;
			await beforeFetch();
			const url = String(input);
			if (url === `https://git.cafe/api/orgs/${installation.org}/members/`)
				return Response.json(membersResponse);
			if (
				url ===
				`https://git.cafe/api/repos/${installation.org}/${repository.name}`
			)
				return Response.json(repositoryResponse);
			throw new Error("unexpected connection URL");
		},
	};
});

afterAll(async () => {
	await boss?.stop({ graceful: false });
	await pool?.end();
	await container?.stop();
});

test("explicit bounded action persists first-class GitCafe rows without linking the delegated account", async () => {
	const result = await connectGitCafeInstallation(deps, job);
	expect(result).toEqual({ ok: true, repoCount: 1 });
	const [row] = await db.select().from(repos);
	expect(row).toMatchObject({
		forge: "gitcafe",
		externalId: repository.id,
		fullName: `${repository.owner}/${repository.name}`,
		orgId: job.orgId,
		armed: false,
	});
	expect(
		await orgServices.getOrgRepo(db, {
			orgId: job.orgId,
			repoName: repository.name,
			owner: repository.owner,
			forge: "gitcafe",
		}),
	).not.toBeNull();
	expect(await orgServices.listOrgSwitcherRepos(db, job.orgId)).toHaveLength(1);
	expect(await db.select().from(account)).toHaveLength(0);
	expect(reads).toBe(4);
	expect(lookupCount).toBe(4);
});

test("same-org concurrent claims are idempotent and another org cannot steal installation or repositories", async () => {
	expect(
		await Promise.all([
			connectGitCafeInstallation(deps, job),
			connectGitCafeInstallation(deps, job),
		]),
	).toEqual([
		{ ok: true, repoCount: 1 },
		{ ok: true, repoCount: 1 },
	]);
	const other = generateId();
	await db.insert(organization).values({
		id: other,
		name: "Other",
		slug: `other-${other}`,
		isPersonal: false,
	});
	await db.insert(member).values({
		id: generateId(),
		userId: job.userId,
		organizationId: other,
		role: "admin",
	});
	expect(
		await connectGitCafeInstallation(deps, { ...job, orgId: other }),
	).toEqual({ ok: false, reason: "ownership-conflict" });
	expect(await db.select().from(repos)).toHaveLength(1);
	expect(
		(await db.select().from(organizationInstallations))[0]?.organizationId,
	).toBe(job.orgId);
});

test("GitHub rows with the same external identity and name remain isolated", async () => {
	await repoServices.ensureRepo(db, {
		forge: "github",
		externalId: repository.id,
		owner: repository.owner,
		name: repository.name,
		fullName: `${repository.owner}/${repository.name}`,
	});
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
	expect(
		(await db.select().from(repos)).map((row) => row.forge).sort(),
	).toEqual(["gitcafe", "github"]);
});

test("stale and future jobs, unexpected secrets and client actor extensions are rejected before provider reads", async () => {
	for (const input of [
		{ ...job, expiresAt: Date.now() - 1, authorizedAt: Date.now() - 60_000 },
		{ ...job, authorizedAt: Date.now() + 10_000 },
		{ ...job, accessToken: "secret" },
	])
		expect((await connectGitCafeInstallation(deps, input)).ok).toBe(false);
	expect(reads).toBe(0);
});

test("revoked, impersonated, expired, unapproved or banned sessions fail before provider reads", async () => {
	await db
		.update(session)
		.set({ impersonatedBy: generateId() })
		.where(eq(session.id, job.sessionId));
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "unauthorized",
	});
	await db
		.update(session)
		.set({ impersonatedBy: null, expiresAt: new Date(0) })
		.where(eq(session.id, job.sessionId));
	expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	await db
		.update(session)
		.set({ expiresAt: new Date(Date.now() + 60_000) })
		.where(eq(session.id, job.sessionId));
	for (const update of [
		{ accessStatus: "pending" as const },
		{ accessStatus: "approved" as const, banned: true },
	]) {
		await db.update(user).set(update).where(eq(user.id, job.userId));
		expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	}
	await db.delete(session).where(eq(session.id, job.sessionId));
	expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	expect(reads).toBe(0);
});

test("current custom connections:manage permission authorizes, and removal before atomic commit refuses", async () => {
	await db
		.update(member)
		.set({ role: "connection-manager" })
		.where(eq(member.userId, job.userId));
	await db.insert(organizationRole).values({
		id: generateId(),
		organizationId: job.orgId,
		role: "connection-manager",
		permission: JSON.stringify({ connections: ["manage"] }),
	});
	beforeFetch = async () => {
		if (reads === 2) await db.delete(organizationRole);
	};
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "unauthorized",
	});
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("current custom connections:manage permission allows a person with no local provider account", async () => {
	await db
		.update(member)
		.set({ role: "connection-manager" })
		.where(eq(member.userId, job.userId));
	await db.insert(organizationRole).values({
		id: generateId(),
		organizationId: job.orgId,
		role: "connection-manager",
		permission: JSON.stringify({ connections: ["manage"] }),
	});
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
});

test("actor authority is fresh at mutation and incomplete member pages fail closed", async () => {
	beforeFetch = async () => {
		if (reads === 3) membersResponse = { ...membership, items: [] };
	};
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "not-admin",
	});
	expect(await db.select().from(organizationInstallations)).toHaveLength(0);
	beforeFetch = async () => {};
	membersResponse = { ...membership, next: "next-page" };
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "authority-unavailable",
	});
});

test("inactive, wrong-app, all-selection and unstable installation evidence fail closed", async () => {
	for (const change of [
		{ pausedAt: new Date().toISOString() },
		{ appId: "wrong-app" },
		{ repositorySelection: "all" as const },
		{ repositories: [repository.name, repository.name] },
	]) {
		changedLookup = () => ({ ...installation, ...change });
		expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	}
	changedLookup = () => ({
		...installation,
		revision: installation.revision + lookupCount,
	});
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "installation-mismatch",
	});
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("wrong owner, selected name, missing stable id, and disappearing repository are refused", async () => {
	for (const response of [
		{ ...repository, owner: "other" },
		{ ...repository, name: "other" },
		{ ...repository, id: undefined },
		null,
	]) {
		repositoryResponse = response;
		expect(await connectGitCafeInstallation(deps, job)).toEqual({
			ok: false,
			reason: "repository-mismatch",
		});
	}
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("generic claims cannot bypass GitCafe fresh authority and protection remains off", async () => {
	expect(
		await orgServices.linkOrgInstallation(db, {
			forge: "gitcafe",
			orgId: job.orgId,
			installationId: job.installationId,
		}),
	).toEqual({ claimed: false });
	expect(
		await orgServices.moveInstallation(db, {
			forge: "gitcafe",
			toOrgId: job.orgId,
			installationId: job.installationId,
		}),
	).toEqual({ moved: false });
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
	const [row] = await db.select().from(repos);
	if (!row) throw new Error("missing connected row");
	await expect(repoServices.setRepoArmed(db, row.id, true)).rejects.toThrow(
		"Protection is unavailable",
	);
	await expect(repoServices.turnOnGate(db, boss, row.id)).rejects.toThrow(
		"Protection is unavailable",
	);
	const workflowId = await repoServices.saveWorkflowDefinition(
		db,
		row.id,
		DEFAULT_WORKFLOW,
	);
	expect(
		await workflowServices.setWorkflowEnabled(db, {
			repoId: row.id,
			workflowId,
			enabled: true,
		}),
	).toEqual({
		ok: false,
		issues: [{ message: "Protection is unavailable for this forge" }],
	});
	expect((await repoServices.getRepoById(db, row.id))?.armed).toBe(false);
});

test("bounded status proves job metadata and current local authorization before exposing connection count", async () => {
	const queued = await gitCafeConnectionServices.enqueueGitCafeConnection(
		db,
		boss,
		job,
	);
	if (!queued.ok) throw new Error("enqueue refused");
	const request = {
		userId: job.userId,
		sessionId: job.sessionId,
		orgId: job.orgId,
		installationId: job.installationId,
		jobId: queued.jobId,
	};
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(
			db,
			boss,
			request,
		),
	).toEqual({ status: "pending" });
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(db, boss, {
			...request,
			installationId: "ins_other",
		}),
	).toEqual({ status: "retry" });
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
	await boss.complete(
		GITCAFE_CONNECT_QUEUE,
		queued.jobId,
		{ ok: true, repoCount: 1 },
		{ includeQueued: true },
	);
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(
			db,
			boss,
			request,
		),
	).toEqual({ status: "connected", repoCount: 1 });
	await db
		.update(member)
		.set({ role: "member" })
		.where(eq(member.userId, job.userId));
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(
			db,
			boss,
			request,
		),
	).toEqual({ status: "refused", reason: "unauthorized" });
});

test("isolated connection queue startup leaves unrelated backlog untouched", async () => {
	const backlogId = await boss.send("process-event", { eventId: generateId() });
	if (!backlogId) throw new Error("missing backlog job");
	const before = await boss.getJobById("process-event", backlogId);
	const isolated = await createGitCafeConnectionBoss(
		container.url,
		pino({ enabled: false }),
	);
	try {
		expect(await isolated.getJobById("process-event", backlogId)).toEqual(
			before,
		);
		const queued = await isolated.send(GITCAFE_CONNECT_QUEUE, job, {
			retryLimit: 0,
		});
		expect(queued).not.toBeNull();
		expect((await isolated.getJobById("process-event", backlogId))?.state).toBe(
			"created",
		);
	} finally {
		await isolated.stop({ graceful: false });
	}
});
