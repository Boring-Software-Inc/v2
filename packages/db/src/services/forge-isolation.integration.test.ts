import { afterAll, beforeAll, expect, test } from "bun:test";
import type { ForgeId, RepoIdentity } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	PROCESS_EVENT_QUEUE,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { organization } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { runActions, runs } from "../schema/runs.ts";
import { countPendingReviews } from "./account-deletion.ts";
import {
	changeRequestIsClosed,
	getLatestChangeRequestEvent,
	insertRawEvent,
	listActivityFeed,
	markEventNormalized,
} from "./events.ts";
import { computeDailyRollups, getHomeStats } from "./insights.ts";
import {
	closeReviewsForChangeRequest,
	closeReviewsOfClosedChangeRequests,
	decideRepoModerationItem,
	listPendingItems,
} from "./moderation.ts";
import { getOrgRepo, listOrgSwitcherRepos } from "./organizations.ts";
import {
	closedOnHead,
	getActiveBlockReviewId,
	getLatestRunIdForChangeRequest,
	getPreviousVerdict,
	latestRunIdForRepo,
	listOpenBlockedRuns,
	listRepoRuns,
	listRunsForChangeRequest,
	listStuckActions,
} from "./runs.ts";

let database: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let boss: Awaited<ReturnType<typeof createBoss>>;
const FULL_NAME = "same-owner/same-repo";
const github: RepoIdentity = { forge: "github", fullName: FULL_NAME };
const gitcafe: RepoIdentity = { forge: "gitcafe", fullName: FULL_NAME };
const orgIds = [generateId(), generateId()];
const repoIds = new Map<ForgeId, string>();
const runIds = new Map<ForgeId, string>();
const itemIds = new Map<ForgeId, string>();
const eventIds = new Map<ForgeId, string>();

beforeAll(async () => {
	database = await createTestDatabase();
	({ db, pool } = createDb(database.url));
	await applyMigrations(db);
	boss = await createBoss(database.url);
	for (const [index, scope] of [github, gitcafe].entries()) {
		const orgId = orgIds[index];
		if (!orgId) {
			throw new Error("missing test org");
		}
		await db
			.insert(organization)
			.values({ id: orgId, name: orgId, slug: orgId });
		const repoId = generateId();
		repoIds.set(scope.forge, repoId);
		await db.insert(repos).values({
			id: repoId,
			forge: sql`${scope.forge}`,
			externalId: "same-external-id",
			owner: "same-owner",
			name: "same-repo",
			fullName: FULL_NAME,
			orgId,
			private: scope.forge === "gitcafe",
		});
		const eventId = generateId();
		eventIds.set(scope.forge, eventId);
		await db.insert(events).values({
			id: eventId,
			forge: sql`${scope.forge}`,
			deliveryId: "same-delivery-id",
			rawKind: "database-isolation-test",
			raw: {},
			kind: "change-request.opened",
			repoFullName: FULL_NAME,
			subjectNumber: 7,
			normalizedAt: new Date(),
			normalized: {
				kind: "change-request.opened",
				actor: { login: "contributor", externalId: "actor-string" },
				changeRequest: { number: 7, title: `${scope.forge} title` },
			},
		});
		const runId = generateId();
		runIds.set(scope.forge, runId);
		await db.insert(runs).values({
			id: runId,
			eventId,
			repoFullName: FULL_NAME,
			subjectNumber: 7,
			headSha: "same-head",
			status: "paused",
			verdict: scope.forge === "github" ? "changes_required" : "block",
			workflowSnapshot: [],
		});
		const itemId = generateId();
		itemIds.set(scope.forge, itemId);
		await db
			.insert(moderationItems)
			.values({ id: itemId, runId, nodeId: "review" });
		await db.insert(runActions).values({
			id: generateId(),
			runId,
			kind: "block",
			payload: {},
			idempotencyKey: "block",
			status: "executed",
			externalId: `${scope.forge}-review`,
		});
	}
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false });
	await pool?.end();
	await database?.stop();
});

test("same names, numbers, external ids and delivery ids retain separate histories", async () => {
	for (const repo of [github, gitcafe]) {
		expect(await getLatestChangeRequestEvent(db, repo, 7)).toMatchObject({
			id: eventIds.get(repo.forge),
			forge: repo.forge,
		});
		expect(await getLatestRunIdForChangeRequest(db, repo, 7)).toBe(
			runIds.get(repo.forge) ?? null,
		);
		expect(await latestRunIdForRepo(db, repo)).toBe(
			runIds.get(repo.forge) ?? null,
		);
		expect(
			(await listRunsForChangeRequest(db, repo, 7)).map((run) => run.id),
		).toEqual([runIds.get(repo.forge) ?? "missing"]);
		expect(
			(await listRepoRuns(db, { repos: [repo], limit: 20 })).map(
				(run) => run.id,
			),
		).toEqual([runIds.get(repo.forge) ?? "missing"]);
		expect(await getActiveBlockReviewId(db, repo, 7)).toBe(
			`${repo.forge}-review`,
		);
	}
	expect(await getPreviousVerdict(db, github, 7, "other-run")).toBe(
		"changes_required",
	);
	expect(await getPreviousVerdict(db, gitcafe, 7, "other-run")).toBe("block");
	const feed = await listActivityFeed(db, { repo: github });
	expect(feed.items).toHaveLength(1);
	expect(feed.items[0]).toMatchObject({
		type: "group",
		group: {
			title: "github title",
			currentVerdict: "changes_required",
			eventCount: 1,
		},
	});
});

test("org aggregates and queues do not include the other forge's private evidence", async () => {
	expect(await countPendingReviews(db, [orgIds[0] ?? "missing"])).toBe(1);
	const rows = await listOrgSwitcherRepos(db, orgIds[0] ?? "missing");
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		forge: "github",
		pendingModeration: 1,
		blocked24h: 1,
	});
	expect((await listPendingItems(db, [github])).map((item) => item.id)).toEqual(
		[itemIds.get("github") ?? "missing"],
	);
	expect((await getHomeStats(db, github)).blocked.value).toBe(1);
	expect((await getHomeStats(db, gitcafe)).blocked.value).toBe(1);
	await computeDailyRollups(db, new Date().toISOString().slice(0, 10));
	const counts = await db.execute(
		sql`SELECT repo_id, blocked FROM rollups_daily ORDER BY repo_id`,
	);
	expect(
		counts.rows.find((row) => row.repo_id === repoIds.get("github"))?.blocked,
	).toBe(1);
	expect(
		counts.rows.find((row) => row.repo_id === repoIds.get("gitcafe"))?.blocked,
	).toBe(1);
});

test("a wrong forge cannot decide another forge's moderation item", async () => {
	const itemId = itemIds.get("gitcafe");
	if (!itemId) {
		throw new Error("missing test item");
	}
	expect(
		await decideRepoModerationItem(db, null, {
			repo: github,
			itemId,
			decision: "approve",
			decidedBy: null,
		}),
	).toBe("not-found");
	const [item] = await db
		.select()
		.from(moderationItems)
		.where(eq(moderationItems.id, itemId));
	expect(item?.status).toBe("pending");
});

test("a close on another forge cannot close the queue, hide a held run, or fence this head", async () => {
	await db.insert(events).values({
		id: generateId(),
		forge: sql`${gitcafe.forge}`,
		deliveryId: generateId(),
		rawKind: "database-isolation-test",
		raw: {},
		kind: "change-request.closed",
		repoFullName: FULL_NAME,
		subjectNumber: 7,
		normalizedAt: new Date(),
	});
	expect(await changeRequestIsClosed(db, github, 7)).toBe(false);
	expect(await changeRequestIsClosed(db, gitcafe, 7)).toBe(true);
	expect(
		(await listOpenBlockedRuns(db, github, new Date(0))).map(
			(run) => run.runId,
		),
	).toEqual([runIds.get("github") ?? "missing"]);
	expect(
		await closeReviewsOfClosedChangeRequests(db, "https://tripwire.sh"),
	).toEqual([]);
	await db.insert(runActions).values({
		id: generateId(),
		runId: runIds.get("gitcafe") ?? "missing",
		kind: "close",
		payload: {},
		idempotencyKey: "close",
		status: "executed",
	});
	expect(await closedOnHead(db, github, 7, "same-head")).toBe(false);
	expect(await closedOnHead(db, gitcafe, 7, "same-head")).toBe(true);
	await closeReviewsForChangeRequest(db, "https://tripwire.sh", github, 7);
	expect(
		(await listPendingItems(db, [gitcafe])).map((item) => item.id),
	).toEqual([itemIds.get("gitcafe") ?? "missing"]);
});

test("connected GitCafe rows enter routing but never action retries", async () => {
	await db.insert(runActions).values({
		id: generateId(),
		runId: runIds.get("gitcafe") ?? "missing",
		kind: "label",
		payload: {},
		idempotencyKey: "recorded",
		recordedAt: new Date(0),
	});
	expect(
		await getOrgRepo(db, {
			orgId: orgIds[1] ?? "missing",
			repoName: "same-repo",
			forge: "gitcafe",
		}),
	).not.toBeNull();
	expect(
		(await listStuckActions(db, new Date())).some(
			(action) => action.runId === runIds.get("gitcafe"),
		),
	).toBe(false);
});

test("ingest deduplicates within a forge, without swallowing another forge's delivery", async () => {
	const raw = await Bun.file(
		new URL(
			"../../../forge-github/fixtures/installation.created.json",
			import.meta.url,
		),
	).json();
	const input = { deliveryId: generateId(), rawKind: "installation", raw };
	const first = await insertRawEvent(pool, boss, { ...input, forge: "github" });
	const second = await insertRawEvent(pool, boss, {
		...input,
		forge: "opengit",
	});
	expect(first.inserted).toBe(true);
	expect(second.inserted).toBe(true);
	expect(first.eventId).not.toBe(second.eventId);
	const queued = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND data->>'eventId' IN ($2, $3)",
		[PROCESS_EVENT_QUEUE, first.eventId, second.eventId],
	);
	expect(queued.rows[0]?.n).toBe(2);
	expect(
		(await insertRawEvent(pool, boss, { ...input, forge: "github" })).inserted,
	).toBe(false);
	expect(
		(await insertRawEvent(pool, boss, { ...input, forge: "opengit" })).inserted,
	).toBe(false);
});

test("normalization cannot replace a stored event with another forge's identity", async () => {
	const eventId = eventIds.get("github");
	if (!eventId) {
		throw new Error("missing test event");
	}
	const now = new Date().toISOString();
	await expect(
		markEventNormalized(db, pool, eventId, {
			id: eventId,
			forge: "opengit",
			deliveryId: "same-delivery-id",
			kind: "comment.created",
			repo: { owner: "same-owner", name: "same-repo", fullName: FULL_NAME },
			actor: { login: "contributor", externalId: "actor-string" },
			occurredAt: now,
			receivedAt: now,
			comment: {
				externalId: "comment-string",
				body: "text",
				url: "https://open-git.com/same-owner/same-repo",
				subjectNumber: 7,
			},
		}),
	).rejects.toThrow("forge does not match");
	const [row] = await db.select().from(events).where(eq(events.id, eventId));
	expect(row?.kind).toBe("change-request.opened");
});
