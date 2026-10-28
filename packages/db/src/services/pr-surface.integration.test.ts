import { afterAll, beforeAll, expect, test } from "bun:test";
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
	createRun,
	getActiveBlockReviewId,
	getLatestBlockReviewId,
	getPreviousVerdict,
	markActionExecuted,
	recordActions,
} from "./runs.ts";

/**
 * §7 comment lifecycle — the two reads that decide a verdict transition and the
 * stale-review dismissal: the PR's currently-shown verdict, and the forge id of
 * the outstanding request-changes review to dismiss when a block clears.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = "acme/app";
const SNAPSHOT = [DEFAULT_WORKFLOW];

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);
afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function seedRun(
	id: string,
	verdict: "pass" | "block" | "needs_review",
): Promise<string> {
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.updated",
		repoFullName: REPO,
	});
	return createRun(db, {
		eventId: id,
		repoFullName: REPO,
		subjectNumber: 1,
		headSha: `sha-${id}`,
		snapshot: SNAPSHOT,
		status: "completed",
		verdict,
	});
}

test("getPreviousVerdict + getLatestBlockReviewId drive the transition & dismissal", async () => {
	// First run: a block that files a request-changes review (external id 91).
	const blockRun = await seedRun("evt-block", "block");
	const [blockAction] = await recordActions(db, blockRun, [
		{ kind: "block", payload: {}, idempotencyKey: "block:1" },
	]);
	if (!blockAction) {
		throw new Error("expected a recorded block action");
	}
	await markActionExecuted(db, blockAction.id, "91");

	// Before the second run exists, the block run is the first-time verdict.
	expect(
		await getPreviousVerdict(
			db,
			{ forge: "github", fullName: REPO },
			1,
			blockRun,
		),
	).toBeNull();

	// Second run: the fix passes. The PR currently shows "block" (a transition),
	// and the review to dismiss is the block run's review 91.
	const passRun = await seedRun("evt-pass", "pass");
	expect(
		await getPreviousVerdict(
			db,
			{ forge: "github", fullName: REPO },
			1,
			passRun,
		),
	).toBe("block");
	expect(
		await getLatestBlockReviewId(db, { forge: "github", fullName: REPO }, 1),
	).toBe("91");

	// A different change request shares nothing.
	expect(
		await getLatestBlockReviewId(
			db,
			{ forge: "github", fullName: "acme/other" },
			1,
		),
	).toBeNull();
});

test("getActiveBlockReviewId: live until dismissed", async () => {
	const blockRun = await seedRun("evt-active-block", "block");
	const [block] = await recordActions(db, blockRun, [
		{ kind: "block", payload: {}, idempotencyKey: "block:active" },
	]);
	if (!block) {
		throw new Error("expected a recorded block action");
	}
	await markActionExecuted(db, block.id, "95");
	expect(
		await getActiveBlockReviewId(db, { forge: "github", fullName: REPO }, 1),
	).toBe("95");

	const passRun = await seedRun("evt-active-pass", "pass");
	const [dismiss] = await recordActions(db, passRun, [
		{
			kind: "dismiss-review",
			payload: { number: 1, reviewId: "95" },
			idempotencyKey: "dismiss-review:95",
		},
	]);
	if (!dismiss) {
		throw new Error("expected a recorded dismissal");
	}
	expect(
		await getActiveBlockReviewId(db, { forge: "github", fullName: REPO }, 1),
	).toBe("95");
	await markActionExecuted(db, dismiss.id, "95");
	expect(
		await getActiveBlockReviewId(db, { forge: "github", fullName: REPO }, 1),
	).toBeNull();
	expect(
		await getActiveBlockReviewId(
			db,
			{ forge: "github", fullName: "acme/other" },
			1,
		),
	).toBeNull();
});
