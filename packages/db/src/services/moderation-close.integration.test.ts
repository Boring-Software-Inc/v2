import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	DEFAULT_RESPONSE_CONFIG,
	DEFAULT_WORKFLOW,
	renderClosedBeforeReviewComment,
} from "@tripwire/contracts";
import { sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { listRecentRuns } from "./insights.ts";
import {
	closeReviewsForChangeRequest,
	closeReviewsOfClosedChangeRequests,
	createModerationItem,
	getModerationItem,
	listPendingItems,
	markModerationDecided,
} from "./moderation.ts";
import {
	getRepoByFullName,
	syncInstallationRepos,
	upsertResponseConfig,
} from "./repos.ts";
import { createRun, getRunById, recordActions } from "./runs.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = "acme/queue";
const APP_URL = "https://tripwire.test";

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function pausedRun(id: string, repo: string, number: number) {
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.opened",
		repoFullName: repo,
		subjectNumber: number,
		actorLogin: "octocat",
	});
	const runId = await createRun(db, {
		eventId: id,
		repoFullName: repo,
		subjectNumber: number,
		headSha: `sha-${id}`,
		snapshot: [DEFAULT_WORKFLOW],
		status: "paused",
		verdict: "needs_review",
	});
	const itemId = await createModerationItem(db, { runId, nodeId: "w:review" });
	return { runId, itemId };
}

async function pausedItem(id: string, repo: string, number: number) {
	return (await pausedRun(id, repo, number)).itemId;
}

async function withPostedCheck(runId: string, sha: string) {
	await recordActions(db, runId, [
		{
			kind: "set-check",
			payload: {
				sha,
				conclusion: "pending",
				summary: "Waiting for human review.",
				detailsUrl: `https://tripwire.test/runs/${runId}`,
			},
			idempotencyKey: `check:${sha}:needs_review`,
		},
	]);
}

async function closedEvent(id: string, repo: string, number: number) {
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.closed",
		repoFullName: repo,
		subjectNumber: number,
	});
}

describe("closing a change request", () => {
	test("closes its pending queue items and leaves everything else alone", async () => {
		const open = await pausedItem("evt-140", REPO, 140);
		const decided = await pausedItem("evt-140-old", REPO, 140);
		await markModerationDecided(db, {
			itemId: decided,
			decision: "approve",
			decidedBy: null,
		});
		const otherNumber = await pausedItem("evt-141", REPO, 141);
		const otherRepo = await pausedItem("evt-other", "acme/elsewhere", 140);

		await closeReviewsForChangeRequest(db, APP_URL, REPO, 140);

		expect((await getModerationItem(db, open))?.status).toBe("closed");
		expect((await getModerationItem(db, open))?.decidedAt).not.toBeNull();
		expect((await getModerationItem(db, decided))?.status).toBe("approved");
		const pending = await listPendingItems(db, [REPO, "acme/elsewhere"]);
		expect(pending.map((item) => item.id).sort()).toEqual(
			[otherNumber, otherRepo].sort(),
		);
	});

	test("a closed item can no longer be decided", async () => {
		const item = await pausedItem("evt-142", REPO, 142);
		await closeReviewsForChangeRequest(db, APP_URL, REPO, 142);
		expect(
			await markModerationDecided(db, {
				itemId: item,
				decision: "approve",
				decidedBy: null,
			}),
		).toBe(false);
	});

	test("the waiting run closes, and its check is set to neutral", async () => {
		const { runId } = await pausedRun("evt-143", REPO, 143);
		await withPostedCheck(runId, "sha-evt-143");

		const closed = await closeReviewsForChangeRequest(db, APP_URL, REPO, 143);

		const run = await getRunById(db, runId);
		expect(run?.status).toBe("closed");
		expect(run?.verdict).toBe("needs_review");
		expect(run?.completedAt).not.toBeNull();
		expect(closed).toEqual([
			{
				runId,
				repoFullName: REPO,
				subjectNumber: 143,
				check: {
					id: expect.any(String),
					kind: "set-check",
					payload: {
						sha: "sha-evt-143",
						conclusion: "neutral",
						summary: "Closed before review.",
						detailsUrl: `https://tripwire.test/runs/${runId}`,
					},
				},
				comment: {
					id: expect.any(String),
					kind: "comment",
					payload: {
						number: 143,
						verdict: "needs_review",
						previousVerdict: "needs_review",
						body: renderClosedBeforeReviewComment({
							contributorLogin: "octocat",
							runUrl: `${APP_URL}/runs/${runId}`,
							showRunLink: true,
						}),
						onlyIfPresent: true,
					},
				},
			},
		]);
		expect(await closeReviewsForChangeRequest(db, APP_URL, REPO, 143)).toEqual(
			[],
		);
		const awaiting = await listRecentRuns(db, {
			repoFullName: REPO,
			verdicts: ["needs_review"],
			limit: 100,
		});
		expect(awaiting.map((row) => row.runId)).not.toContain(runId);
	});

	test("a waiting run that never posted a check closes without one", async () => {
		const { runId } = await pausedRun("evt-144", REPO, 144);
		const closed = await closeReviewsForChangeRequest(db, APP_URL, REPO, 144);
		expect(closed).toMatchObject([
			{
				runId,
				repoFullName: REPO,
				subjectNumber: 144,
				check: null,
				comment: { kind: "comment" },
			},
		]);
	});

	test("the closed comment hides the run link when the repo hides it", async () => {
		await syncInstallationRepos(
			db,
			"inst-1",
			[
				{
					externalId: "9146",
					owner: "acme",
					name: "quiet",
					fullName: "acme/quiet",
					private: false,
				},
			],
			[],
		);
		const repo = await getRepoByFullName(db, "acme/quiet", "github");
		await upsertResponseConfig(db, repo?.id ?? "", {
			...DEFAULT_RESPONSE_CONFIG,
			reviewComment: { customText: "", showDetailsButton: false },
		});
		await pausedRun("evt-146", "acme/quiet", 146);
		const [closed] = await closeReviewsForChangeRequest(
			db,
			APP_URL,
			"acme/quiet",
			146,
		);
		expect(closed?.comment?.payload.body).toBe(
			renderClosedBeforeReviewComment({
				contributorLogin: "octocat",
				runUrl: "",
				showRunLink: false,
			}),
		);
	});

	test("a newer run on the same head keeps the check", async () => {
		const { runId } = await pausedRun("evt-145", REPO, 145);
		await withPostedCheck(runId, "sha-evt-145");
		await db.insert(events).values({
			id: "evt-145-rerun",
			deliveryId: "d-evt-145-rerun",
			rawKind: "pull_request",
			raw: {},
			kind: "change-request.updated",
			repoFullName: REPO,
			subjectNumber: 145,
		});
		await createRun(db, {
			eventId: "evt-145-rerun",
			repoFullName: REPO,
			subjectNumber: 145,
			headSha: "sha-evt-145",
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "pass",
		});
		const [closed] = await closeReviewsForChangeRequest(db, APP_URL, REPO, 145);
		expect(closed?.runId).toBe(runId);
		expect(closed?.check).toBeNull();
		expect(closed?.comment).toBeNull();
	});
});

describe("reviews left waiting on change requests closed earlier", () => {
	test("close, run and item alike, while open change requests keep waiting", async () => {
		const stale = await pausedRun("evt-150", REPO, 150);
		await withPostedCheck(stale.runId, "sha-evt-150");
		await closedEvent("evt-150-closed", REPO, 150);
		const itemOnly = await pausedRun("evt-151", REPO, 151);
		await closeReviewsForChangeRequest(db, APP_URL, REPO, 151);
		await db.execute(
			sql`UPDATE runs SET status = 'paused', completed_at = NULL WHERE id = ${itemOnly.runId}`,
		);
		await closedEvent("evt-151-closed", REPO, 151);
		const reopened = await pausedRun("evt-152", REPO, 152);
		await closedEvent("evt-152-closed", REPO, 152);
		await db.insert(events).values({
			id: "evt-152-reopened",
			deliveryId: "d-evt-152-reopened",
			rawKind: "pull_request",
			raw: {},
			kind: "change-request.opened",
			repoFullName: REPO,
			subjectNumber: 152,
			receivedAt: new Date(Date.now() + 1000),
		});
		const open = await pausedRun("evt-153", REPO, 153);

		const closed = await closeReviewsOfClosedChangeRequests(db, APP_URL);

		expect(closed.map((row) => row.runId).sort()).toEqual(
			[stale.runId, itemOnly.runId].sort(),
		);
		expect(
			closed.find((row) => row.runId === stale.runId)?.check?.payload,
		).toMatchObject({ sha: "sha-evt-150", conclusion: "neutral" });
		expect((await getModerationItem(db, stale.itemId))?.status).toBe("closed");
		expect((await getRunById(db, itemOnly.runId))?.status).toBe("closed");
		expect((await getRunById(db, reopened.runId))?.status).toBe("paused");
		expect((await getModerationItem(db, open.itemId))?.status).toBe("pending");
		expect(await closeReviewsOfClosedChangeRequests(db, APP_URL)).toEqual([]);
	});
});
