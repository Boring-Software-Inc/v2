import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_SCHEDULE_TICK_QUEUE,
	gitCafeReadIssueThreadSchema,
	normalizedEventSchema,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createGitCafeConnectionBoss,
	createTestDatabase,
	eventServices,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	organization,
	organizationInstallations,
	repoServices,
	repos,
	runServices,
	scheduleServices,
	type TestDatabase,
	workflowDefinitions,
} from "@tripwire/db";
import installation from "@tripwire/forge-gitcafe/fixtures/gitcafe-action-installation-current.json";
import token from "@tripwire/forge-gitcafe/fixtures/gitcafe-action-token-current.json";
import repository from "@tripwire/forge-gitcafe/fixtures/gitcafe-connection-repository.json";
import issuePage from "@tripwire/forge-gitcafe/fixtures/gitcafe-read-issues-list.json";
import { generateId, sleep } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { staticForge } from "./forge-runtime.ts";
import { registerGitCafeProtectionQueues } from "./gitcafe-protection-worker.ts";
import { buildGitCafeRuntime } from "./gitcafe-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";
import { scheduleTick } from "./jobs/schedule-tick.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

let container: TestDatabase;
let database: ReturnType<typeof createDb>;
let boss: Awaited<ReturnType<typeof createBoss>>;
let repoId: string;
let workflowId: string;
let subject = gitCafeReadIssueThreadSchema.parse(issuePage.items[0]);
let writes: string[];
let onRead: ((path: string) => Promise<void>) | undefined;
let lockOutage: boolean;
const logger = pino({ level: "silent" });
const at = new Date("2026-11-01T12:00:00Z");
const definition = workflowDefinitionSchema.parse({
	id: "gc-inactive",
	name: "Lock inactive issues",
	version: 1,
	nodes: [
		{
			id: "tick",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: {
				every: { n: 1, unit: "hours" },
				match: {
					subjects: ["issue"],
					state: "open",
					inactiveFor: { n: 1, unit: "days" },
					skipLocked: true,
				},
			},
		},
		{
			id: "lock",
			type: "action",
			action: "lock",
			params: { reason: "resolved" },
		},
	],
	edges: [{ id: "tick-lock", from: "tick", to: "lock" }],
});
const credentials = {
	appId: installation.appId,
	keyId: "schedule-test",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};

beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
	boss = await createBoss(container.url);
	await boss.createQueue(GITCAFE_PROCESS_EVENT_QUEUE);
}, 120_000);
beforeEach(async () => {
	await database.db.execute(
		sql`TRUNCATE events, repos, organization, gitcafe_installation_lifecycle CASCADE`,
	);
	await database.pool.query("DELETE FROM pgboss.job");
	const orgId = generateId();
	repoId = generateId();
	workflowId = generateId();
	writes = [];
	onRead = undefined;
	lockOutage = false;
	subject = gitCafeReadIssueThreadSchema.parse(issuePage.items[0]);
	await database.db
		.insert(organization)
		.values({ id: orgId, name: "Schedule test", slug: `schedule-${orgId}` });
	await database.db.insert(organizationInstallations).values({
		id: generateId(),
		forge: "gitcafe",
		installationId: installation.id,
		organizationId: orgId,
		accountLogin: installation.org,
	});
	await database.db.insert(repos).values({
		id: repoId,
		forge: "gitcafe",
		externalId: repository.id,
		owner: repository.owner,
		name: repository.name,
		fullName: "boring/scratch",
		installationId: installation.id,
		orgId,
		armed: true,
	});
	await database.db.insert(gitCafeInstallationLifecycle).values({
		installationId: installation.id,
		status: "active",
		generation: 1,
		authorityAt: new Date(),
	});
	await database.db.insert(workflowDefinitions).values({
		id: workflowId,
		repoId,
		name: definition.name,
		enabled: true,
		definition,
	});
	await boss.send("process-event", { eventId: generateId() });
});
afterAll(async () => {
	await boss?.stop({ graceful: false, close: true });
	await database?.pool.end();
	await container?.stop();
});

function runtime() {
	return buildGitCafeRuntime(database.db, credentials, async (url, init) => {
		const path = new URL(url).pathname;
		await onRead?.(path);
		if (path.includes("/apps/installations/"))
			return Response.json(
				init.method === "GET"
					? installation
					: {
							...token,
							token: "synthetic-schedule-token",
							expiresAt: new Date(Date.now() + 900000).toISOString(),
						},
			);
		if (path === "/api/repos/boring/scratch") return Response.json(repository);
		if (path.endsWith("/issues/"))
			return Response.json({ items: [subject], next: null });
		if (path.endsWith("/issues/2")) return Response.json(subject);
		if (path.endsWith("/labels"))
			return Response.json({ items: [], next: null });
		if (path.endsWith("/lock")) {
			if (lockOutage) {
				lockOutage = false;
				return new Response(null, { status: 503 });
			}
			expect(init.method).toBe("PUT");
			writes.push(path);
			subject = {
				...subject,
				lockedAt: new Date().toISOString(),
				version: subject.version + 1,
			};
			return Response.json(subject);
		}
		return new Response(null, { status: 599 });
	});
}
function deps() {
	const forge = runtime();
	return {
		db: database.db,
		pool: database.pool,
		boss,
		resolveForge: (name: string) => (name === "gitcafe" ? forge : null),
		logger,
		makeGenerate: null,
		appUrl: "https://tripwire.test",
		forge: "gitcafe" as const,
		now: () => at,
		requestId: generateId(),
	};
}
async function eventId() {
	const result = await database.pool.query<{ id: string }>(
		"SELECT id FROM events WHERE forge = 'gitcafe' AND raw_kind = 'schedule.matched'",
	);
	const id = result.rows[0]?.id;
	if (!id) throw new Error("Scheduled event missing");
	return id;
}
async function generalJobs() {
	return (
		await database.pool.query(
			"SELECT to_jsonb(j) AS job FROM pgboss.job j WHERE name = 'process-event' ORDER BY id",
		)
	).rows;
}

test("a GitCafe tick admits one atomic dedicated job and cannot advance another forge's schedule", async () => {
	const gh = await repoServices.ensureRepo(database.db, {
		forge: "github",
		externalId: "synthetic-github",
		owner: "boring",
		name: "scratch",
		fullName: "boring/scratch",
		installationId: "synthetic-github-install",
	});
	await repoServices.setRepoArmed(database.db, gh, true);
	const ghWorkflowId = generateId();
	await database.db.insert(workflowDefinitions).values({
		id: ghWorkflowId,
		repoId: gh,
		name: definition.name,
		enabled: true,
		definition,
	});
	expect(
		(await scheduleServices.listDueSchedules(database.db, new Date())).map(
			(row) => row.workflowRowId,
		),
	).toEqual([ghWorkflowId]);
	const before = await generalJobs();
	expect(await scheduleTick(deps())).toEqual({
		schedules: 1,
		events: 1,
		errors: 0,
	});
	expect(await scheduleTick(deps())).toEqual({
		schedules: 0,
		events: 0,
		errors: 0,
	});
	expect(await generalJobs()).toEqual(before);
	expect(
		await scheduleServices.getScheduleState(database.db, ghWorkflowId, "tick"),
	).toBeNull();
	const jobs = await database.pool.query(
		"SELECT name, data FROM pgboss.job WHERE name = $1",
		[GITCAFE_PROCESS_EVENT_QUEUE],
	);
	expect(jobs.rows).toHaveLength(1);
	expect(jobs.rows[0].data.eventId).toBe(await eventId());
	expect(jobs.rows[0].data.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test("an enqueue outage rolls back the raw event and the next tick queues it once", async () => {
	const send = spyOn(boss, "insert").mockRejectedValueOnce(
		new Error("synthetic-enqueue-outage"),
	);
	try {
		expect(await scheduleTick(deps())).toEqual({
			schedules: 1,
			events: 0,
			errors: 1,
		});
	} finally {
		send.mockRestore();
	}
	expect(
		(await database.pool.query("SELECT count(*)::int AS count FROM events"))
			.rows[0].count,
	).toBe(0);
	expect(
		await scheduleServices.getScheduleState(database.db, workflowId, "tick"),
	).toBeNull();
	expect(await scheduleTick(deps())).toEqual({
		schedules: 1,
		events: 1,
		errors: 0,
	});
});

test("revocation during discovery cannot enqueue a partial scheduled event", async () => {
	onRead = async (path) => {
		if (path.endsWith("/labels")) {
			onRead = undefined;
			await gitCafeLifecycleServices.retireGitCafeInstallation(database.db, {
				installationId: installation.id,
				reason: "paused",
			});
		}
	};
	expect(await scheduleTick(deps())).toEqual({
		schedules: 1,
		events: 0,
		errors: 1,
	});
	expect(
		(await database.pool.query("SELECT count(*)::int AS count FROM events"))
			.rows[0].count,
	).toBe(0);
});

for (const change of ["generation", "disarm", "disconnect"] as const)
	test(`${change} after discovery is fenced by atomic admission`, async () => {
		const insert = gitCafeLifecycleServices.insertGitCafeScheduledEvent;
		const delayed = spyOn(
			gitCafeLifecycleServices,
			"insertGitCafeScheduledEvent",
		).mockImplementation(async (...args) => {
			if (change === "generation")
				await gitCafeLifecycleServices.retireGitCafeInstallation(database.db, {
					installationId: installation.id,
					reason: "paused",
				});
			else if (change === "disarm")
				await database.db
					.update(repos)
					.set({ armed: false })
					.where(eq(repos.id, repoId));
			else
				await repoServices.removeInstallation(
					database.db,
					"gitcafe",
					installation.id,
				);
			return insert(...args);
		});
		try {
			expect(await scheduleTick(deps())).toEqual({
				schedules: 1,
				events: 0,
				errors: 1,
			});
			expect(
				(await database.pool.query("SELECT count(*)::int AS count FROM events"))
					.rows[0].count,
			).toBe(0);
		} finally {
			delayed.mockRestore();
		}
	});

test("concurrent ticks persist one event and dedicated job for the same firing", async () => {
	const results = await Promise.all([
		scheduleTick(deps()),
		scheduleTick(deps()),
	]);
	expect(results.reduce((count, result) => count + result.events, 0)).toBe(1);
	expect(
		(await database.pool.query("SELECT count(*)::int AS count FROM events"))
			.rows[0].count,
	).toBe(1);
	expect(
		(
			await database.pool.query(
				"SELECT count(*)::int AS count FROM pgboss.job WHERE name = $1",
				[GITCAFE_PROCESS_EVENT_QUEUE],
			)
		).rows[0].count,
	).toBe(1);
});

for (const change of [
	"healthy",
	"updated",
	"deleted",
	"interrupted-updated",
] as const)
	test(`scheduled evidence ${change} is checked before evaluation`, async () => {
		const d = deps();
		expect((await scheduleTick(d)).events).toBe(1);
		const id = await eventId();
		if (change === "interrupted-updated") {
			const event = await eventServices.getEventById(database.db, id);
			if (!event) throw new Error("Missing event");
			await eventServices.markEventNormalized(
				database.db,
				database.pool,
				id,
				normalizedEventSchema.parse(event.raw),
			);
		}
		if (change === "updated" || change === "interrupted-updated")
			subject = {
				...subject,
				updatedAt: at.toISOString(),
				version: subject.version + 1,
			};
		if (change === "deleted")
			onRead = async (path) => {
				if (path.endsWith("/issues/2"))
					subject = { ...subject, id: "synthetic-replacement-thread" };
			};
		await processEvent({ ...d, resumeNormalized: true }, { eventId: id });
		const found = await runServices.getRunForEvent(database.db, id);
		if (change === "healthy") {
			expect(found?.status).toBe("completed");
			expect(writes).toEqual(["/api/repos/boring/scratch/issues/2/lock"]);
		} else {
			expect(found).toBeNull();
			expect(writes).toEqual([]);
		}
	});

test("a committed scheduled action recovers without re-evaluating changed evidence", async () => {
	const d = deps();
	expect((await scheduleTick(d)).events).toBe(1);
	const id = await eventId();
	lockOutage = true;
	await processEvent({ ...d, resumeNormalized: true }, { eventId: id });
	const run = await runServices.getRunForEvent(database.db, id);
	if (!run) throw new Error("Missing committed run");
	expect(writes).toEqual([]);
	subject = { ...subject, updatedAt: at.toISOString() };
	await processEvent({ ...d, resumeNormalized: true }, { eventId: id });
	await sweepActions(
		{
			db: database.db,
			logger,
			appUrl: d.appUrl,
			adapterFor: async () => d.resolveForge("gitcafe")?.adapter ?? null,
		},
		{ forge: "gitcafe" },
	);
	expect((await runServices.getRunForEvent(database.db, id))?.id).toBe(run.id);
	expect(writes).toEqual(["/api/repos/boring/scratch/issues/2/lock"]);
});

test("identical code-defined workflow IDs in different repositories cannot collide", async () => {
	const original = await repoServices.getRepoById(database.db, repoId);
	if (!original) throw new Error("Missing test repository");
	const secondId = generateId();
	await database.db.insert(repos).values({
		id: secondId,
		forge: "gitcafe",
		externalId: "synthetic-second-repo",
		owner: "boring",
		name: "second",
		fullName: "boring/second",
		installationId: installation.id,
		orgId: original.orgId,
		armed: true,
	});
	await database.db.insert(workflowDefinitions).values({
		id: generateId(),
		repoId: secondId,
		name: definition.name,
		enabled: true,
		definition,
	});
	const resolveForge = staticForge({
		listThreads: async (repo) => ({
			threads: [
				{
					externalId: `synthetic-thread-${repo}`,
					kind: "issue",
					number: 2,
					title: subject.title,
					url: `https://git.cafe/${repo}/issues/2`,
					state: "open",
					author: subject.author.handle ?? "grim",
					authorExternalId: subject.authorActorId ?? "synthetic-actor",
					labels: [],
					locked: false,
					updatedAt: subject.updatedAt,
				},
			],
			stopped: null,
		}),
	});
	expect(await scheduleTick({ ...deps(), resolveForge })).toEqual({
		schedules: 2,
		events: 2,
		errors: 0,
	});
	expect(
		(
			await database.pool.query(
				"SELECT count(DISTINCT delivery_id)::int AS count FROM events",
			)
		).rows[0].count,
	).toBe(2);
});

test("exhausted and deleted local schedule jobs recover once without replaying completed work", async () => {
	const d = deps();
	expect((await scheduleTick(d)).events).toBe(1);
	const id = await eventId();
	await database.pool.query(
		"UPDATE pgboss.job SET retry_delay = 0, retry_backoff = false WHERE name = $1",
		[GITCAFE_PROCESS_EVENT_QUEUE],
	);
	for (let attempt = 0; attempt <= 10; attempt++) {
		expect(await boss.fetch(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(1);
		await database.pool.query(
			"UPDATE pgboss.job SET started_on = now() - interval '1 hour', expire_seconds = 1 WHERE name = $1",
			[GITCAFE_PROCESS_EVENT_QUEUE],
		);
		await database.pool.query(
			"UPDATE pgboss.queue SET monitor_on = now() - interval '1 hour' WHERE name = $1",
			[GITCAFE_PROCESS_EVENT_QUEUE],
		);
		await boss.supervise(GITCAFE_PROCESS_EVENT_QUEUE);
		await database.pool.query(
			"UPDATE pgboss.job SET start_after = now() - interval '1 second' WHERE name = $1",
			[GITCAFE_PROCESS_EVENT_QUEUE],
		);
	}
	expect(
		(
			await database.pool.query(
				"SELECT state, retry_count FROM pgboss.job WHERE name = $1",
				[GITCAFE_PROCESS_EVENT_QUEUE],
			)
		).rows[0],
	).toEqual({ state: "failed", retry_count: 10 });
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(1);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(0);
	await database.pool.query("DELETE FROM pgboss.job WHERE name = $1", [
		GITCAFE_PROCESS_EVENT_QUEUE,
	]);
	const restored = await Promise.all([
		gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
		gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	]);
	expect(restored.sort()).toEqual([0, 1]);
	await processEvent({ ...d, resumeNormalized: true }, { eventId: id });
	await gitCafeLifecycleServices.finishGitCafeEvent(database.db, id);
	expect(
		(await eventServices.getEventById(database.db, id))?.processedAt,
	).not.toBeNull();
	await database.pool.query("DELETE FROM pgboss.job WHERE name = $1", [
		GITCAFE_PROCESS_EVENT_QUEUE,
	]);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(0);
	expect(writes).toEqual(["/api/repos/boring/scratch/issues/2/lock"]);
});

test("pre-upgrade completed no-run schedules retain completion after job retention", async () => {
	const d = deps();
	expect((await scheduleTick(d)).events).toBe(1);
	const id = await eventId();
	await database.db
		.update(workflowDefinitions)
		.set({ enabled: false })
		.where(eq(workflowDefinitions.id, workflowId));
	const [job] = await boss.fetch(GITCAFE_PROCESS_EVENT_QUEUE);
	if (!job) throw new Error("Scheduled job missing");
	await processEvent({ ...d, resumeNormalized: true }, { eventId: id });
	await boss.complete(GITCAFE_PROCESS_EVENT_QUEUE, job.id);
	expect(
		(await eventServices.getEventById(database.db, id))?.processedAt,
	).toBeNull();
	expect(await runServices.getRunForEvent(database.db, id)).toBeNull();
	await database.db
		.update(workflowDefinitions)
		.set({ enabled: true })
		.where(eq(workflowDefinitions.id, workflowId));
	const general = await generalJobs();
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(0);
	expect(
		(await eventServices.getEventById(database.db, id))?.processedAt,
	).not.toBeNull();
	await database.pool.query("DELETE FROM pgboss.job WHERE name=$1", [
		GITCAFE_PROCESS_EVENT_QUEUE,
	]);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(0);
	expect(await generalJobs()).toEqual(general);
	expect(writes).toEqual([]);
});

test("legacy job completion between recovery snapshots cannot recreate settled work", async () => {
	const d = deps();
	expect((await scheduleTick(d)).events).toBe(1);
	const id = await eventId();
	await database.db
		.update(workflowDefinitions)
		.set({ enabled: false })
		.where(eq(workflowDefinitions.id, workflowId));
	const [job] = await boss.fetch(GITCAFE_PROCESS_EVENT_QUEUE);
	if (!job) throw new Error("Scheduled job missing");
	await processEvent({ ...d, resumeNormalized: true }, { eventId: id });
	await database.db
		.update(workflowDefinitions)
		.set({ enabled: true })
		.where(eq(workflowDefinitions.id, workflowId));
	const lock = await database.pool.connect();
	await lock.query(
		"SELECT pg_advisory_lock(hashtext('legacy-completion-test'))",
	);
	await database.pool.query(
		`CREATE FUNCTION pause_completion_adoption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('legacy-completion-test')); RETURN NULL; END $$`,
	);
	await database.pool.query(
		"CREATE TRIGGER pause_completion_adoption AFTER UPDATE ON events FOR EACH STATEMENT EXECUTE FUNCTION pause_completion_adoption()",
	);
	const recovery = gitCafeLifecycleServices.recoverGitCafeEvents(
		database.db,
		boss,
	);
	try {
		let waiting = false;
		const deadline = Date.now() + 10_000;
		while (!waiting && Date.now() < deadline) {
			waiting =
				(
					await database.pool.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND query LIKE '%UPDATE events e SET%'",
					)
				).rows[0].count > 0;
			if (!waiting) await sleep(10);
		}
		expect(waiting).toBe(true);
		await boss.complete(GITCAFE_PROCESS_EVENT_QUEUE, job.id);
	} finally {
		await lock.query(
			"SELECT pg_advisory_unlock(hashtext('legacy-completion-test'))",
		);
		lock.release();
	}
	let restored: number;
	try {
		restored = await recovery;
	} finally {
		await database.pool.query(
			"DROP TRIGGER pause_completion_adoption ON events",
		);
		await database.pool.query("DROP FUNCTION pause_completion_adoption()");
	}
	expect(restored).toBe(0);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(0);
	expect(
		(await eventServices.getEventById(database.db, id))?.processedAt,
	).not.toBeNull();
	expect(await runServices.getRunForEvent(database.db, id)).toBeNull();
	expect(writes).toEqual([]);
}, 20_000);

test("a waiting consumer rechecks completed no-run work after acquiring the event lock", async () => {
	const d = deps();
	expect((await scheduleTick(d)).events).toBe(1);
	const id = await eventId();
	const lock = await database.pool.connect();
	await lock.query(
		"SELECT pg_advisory_lock(hashtext('gitcafe-process'), hashtext($1))",
		[id],
	);
	const isolated = await createGitCafeConnectionBoss(container.url, logger);
	let unlocked = false;
	try {
		const forge = runtime();
		await registerGitCafeProtectionQueues(
			d,
			isolated,
			forge.prepareCheckRerequest,
			forge,
		);
		let waiting = false;
		const until = Date.now() + 10_000;
		while (!waiting && Date.now() < until) {
			waiting =
				(
					await database.pool.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND query LIKE '%gitcafe-process%'",
					)
				).rows[0].count > 0;
			if (!waiting) await sleep(10);
		}
		expect(waiting).toBe(true);
		await database.db
			.update(workflowDefinitions)
			.set({ enabled: false })
			.where(eq(workflowDefinitions.id, workflowId));
		await processEvent({ ...d, resumeNormalized: true }, { eventId: id });
		expect(await runServices.getRunForEvent(database.db, id)).toBeNull();
		await gitCafeLifecycleServices.finishGitCafeEvent(database.db, id);
		await database.db
			.update(workflowDefinitions)
			.set({ enabled: true })
			.where(eq(workflowDefinitions.id, workflowId));
		await lock.query(
			"SELECT pg_advisory_unlock(hashtext('gitcafe-process'), hashtext($1))",
			[id],
		);
		unlocked = true;
		let state: string | undefined;
		const doneBy = Date.now() + 10_000;
		while (state !== "completed" && Date.now() < doneBy) {
			state = (
				await database.pool.query(
					"SELECT state FROM pgboss.job WHERE name=$1 AND data->>'eventId'=$2",
					[GITCAFE_PROCESS_EVENT_QUEUE, id],
				)
			).rows[0]?.state;
			if (state !== "completed") await sleep(10);
		}
		expect(state).toBe("completed");
		expect(writes).toEqual([]);
		expect(await runServices.getRunForEvent(database.db, id)).toBeNull();
	} finally {
		if (!unlocked)
			await lock.query(
				"SELECT pg_advisory_unlock(hashtext('gitcafe-process'), hashtext($1))",
				[id],
			);
		lock.release();
		await isolated.stop({ graceful: false });
	}
}, 25_000);

test("isolated tick registration processes its own tick without maintaining general backlog or schedules", async () => {
	await boss.stop({ graceful: false });
	await database.db
		.update(repos)
		.set({ armed: false })
		.where(eq(repos.id, repoId));
	await database.pool.query(
		"UPDATE pgboss.job SET state = 'active', started_on = now() - interval '1 day', expire_seconds = 1 WHERE name = 'process-event'",
	);
	const snapshot = async () =>
		(
			await database.pool.query(`SELECT
		(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM pgboss.job j WHERE name NOT LIKE 'gitcafe-%') AS jobs,
		(SELECT jsonb_agg(to_jsonb(q) ORDER BY name) FROM pgboss.queue q WHERE name NOT LIKE 'gitcafe-%') AS queues,
		(SELECT jsonb_agg(to_jsonb(s) ORDER BY name) FROM pgboss.schedule s) AS schedules`)
		).rows;
	const before = await snapshot();
	boss = await createGitCafeConnectionBoss(container.url, logger);
	const d = deps();
	const forge = runtime();
	const queues = await registerGitCafeProtectionQueues(
		d,
		boss,
		forge.prepareCheckRerequest,
		forge,
	);
	expect(queues).toContain(GITCAFE_SCHEDULE_TICK_QUEUE);
	let state: string | undefined;
	const until = Date.now() + 10_000;
	while (Date.now() < until && state !== "completed") {
		state = (
			await database.pool.query(
				"SELECT state FROM pgboss.job WHERE name = $1",
				[GITCAFE_SCHEDULE_TICK_QUEUE],
			)
		).rows[0]?.state;
		if (state !== "completed") await sleep(50);
	}
	expect(state).toBe("completed");
	expect(await snapshot()).toEqual(before);
	expect(writes).toEqual([]);
}, 15_000);
