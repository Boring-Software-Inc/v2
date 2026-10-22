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
import { listOpenBlockedRuns } from "./runs.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = "acme/web";
const DAY = 24 * 60 * 60 * 1000;

async function seedEvent(number: number, kind: string): Promise<string> {
	const id = generateId();
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind,
		repoFullName: REPO,
		subjectNumber: number,
	});
	return id;
}

async function seedRun(
	number: number,
	verdict: "pass" | "block",
	createdAt: Date,
): Promise<string> {
	const id = generateId();
	await db.insert(runs).values({
		id,
		eventId: await seedEvent(number, "change-request.opened"),
		repoFullName: REPO,
		subjectNumber: number,
		headSha: `sha-${number}`,
		status: "completed",
		verdict,
		workflowSnapshot: [],
		createdAt,
	});
	return id;
}

let openBlocked: string;

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);

	openBlocked = await seedRun(1, "block", new Date(Date.now() - DAY));

	await seedRun(2, "block", new Date(Date.now() - 2 * DAY));
	await seedRun(2, "pass", new Date(Date.now() - DAY));

	await seedRun(3, "block", new Date(Date.now() - DAY));
	await seedEvent(3, "change-request.closed");

	await seedRun(4, "block", new Date(Date.now() - 60 * DAY));
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("listOpenBlockedRuns", () => {
	test("only the latest run per open change request, when it blocked", async () => {
		const rows = await listOpenBlockedRuns(
			db,
			REPO,
			new Date(Date.now() - 30 * DAY),
		);
		expect(rows).toEqual([
			{ runId: openBlocked, subjectNumber: 1, headSha: "sha-1" },
		]);
	});

	test("a reopened change request counts as open again", async () => {
		await seedEvent(3, "change-request.updated");
		const rows = await listOpenBlockedRuns(
			db,
			REPO,
			new Date(Date.now() - 30 * DAY),
		);
		expect(rows.map((row) => row.subjectNumber)).toEqual([1, 3]);
	});
});
