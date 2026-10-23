import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { runs } from "../schema/runs.ts";
import { listActivityFeed } from "./events.ts";
import { listRecentRuns } from "./insights.ts";
import {
	getLatestRunIdForChangeRequest,
	listOpenBlockedRuns,
	listRepoRuns,
	listRunsForChangeRequest,
} from "./runs.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = "acme/scheduled";
const HOUR = 60 * 60 * 1000;

async function seedRun(
	kind: "change-request.opened" | "schedule.matched",
	verdict: "pass" | "block",
	createdAt: Date,
): Promise<string> {
	const eventId = generateId();
	await db.insert(events).values({
		id: eventId,
		deliveryId: `d-${eventId}`,
		rawKind: kind === "schedule.matched" ? "schedule" : "pull_request",
		raw: {},
		kind,
		repoFullName: REPO,
		subjectNumber: 60,
		normalized: { kind, actor: { login: "contributor", avatarUrl: null } },
		normalizedAt: createdAt,
		receivedAt: createdAt,
	});
	const id = generateId();
	await db.insert(runs).values({
		id,
		eventId,
		repoFullName: REPO,
		subjectNumber: 60,
		subjectKind: kind === "schedule.matched" ? "change-request" : null,
		headSha: "sha-60",
		status: "completed",
		verdict,
		workflowSnapshot: [],
		createdAt,
	});
	return id;
}

let blockRun: string;
let scheduledRun: string;

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
	blockRun = await seedRun(
		"change-request.opened",
		"block",
		new Date(Date.now() - 2 * HOUR),
	);
	scheduledRun = await seedRun(
		"schedule.matched",
		"pass",
		new Date(Date.now() - HOUR),
	);
}, 120_000);

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("a scheduled run on a change request", () => {
	test("stays out of the change request's verdict chain", async () => {
		const chain = await listRunsForChangeRequest(db, REPO, 60);
		expect(chain.map((row) => row.id)).toEqual([blockRun]);
		expect(await getLatestRunIdForChangeRequest(db, REPO, 60)).toBe(blockRun);
	});

	test("never hides a block from the surface refresh", async () => {
		const rows = await listOpenBlockedRuns(
			db,
			REPO,
			new Date(Date.now() - 24 * HOUR),
		);
		expect(rows.map((row) => row.runId)).toEqual([blockRun]);
	});

	test("never reads as the change request's verdict in the activity feed", async () => {
		const feed = await listActivityFeed(db, { repoFullName: REPO });
		const group = feed.items.find((item) => item.type === "group");
		expect(group?.type === "group" && group.group.currentVerdict).toBe("block");
		expect(group?.type === "group" && group.group.currentRunId).toBe(blockRun);
	});

	test("is marked as scheduled in run lists", async () => {
		const listed = await listRepoRuns(db, { repoFullName: REPO, limit: 10 });
		expect(listed.map((row) => [row.id, row.scheduled]).sort()).toEqual(
			[
				[blockRun, false],
				[scheduledRun, true],
			].sort(),
		);
	});

	test("does not count toward verdict metrics", async () => {
		const recent = await listRecentRuns(db, {
			repoFullName: REPO,
			verdicts: ["pass"],
		});
		expect(recent).toEqual([]);
	});
});
