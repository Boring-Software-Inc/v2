import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import {
	closeModerationItemsForChangeRequest,
	createModerationItem,
	getModerationItem,
	listPendingItems,
	markModerationDecided,
} from "./moderation.ts";
import { createRun } from "./runs.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = "acme/queue";

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function pausedItem(id: string, repo: string, number: number) {
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.opened",
		repoFullName: repo,
		subjectNumber: number,
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
	return await createModerationItem(db, { runId, nodeId: "w:review" });
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

		expect(await closeModerationItemsForChangeRequest(db, REPO, 140)).toBe(1);

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
		await closeModerationItemsForChangeRequest(db, REPO, 142);
		expect(
			await markModerationDecided(db, {
				itemId: item,
				decision: "approve",
				decidedBy: null,
			}),
		).toBe(false);
	});
});
