import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
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
	beginRunEvaluation,
	finalizeRun,
	getLatestRunForChangeRequest,
	getLatestRunIdForChangeRequest,
	getPreviousVerdict,
	listOpenBlockedRuns,
	listRunsForChangeRequest,
} from "./runs.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = "acme/verdict-chain";
const MINUTE = 60 * 1000;
const start = Date.now() - 60 * MINUTE;

type Kind =
	| "change-request.opened"
	| "change-request.updated"
	| "comment.created";

let step = 0;
async function seedRun(
	number: number,
	kind: Kind,
	verdict: "pass" | "block" | "needs_review",
	options: { backfill?: boolean } = {},
): Promise<string> {
	step++;
	const at = new Date(start + step * MINUTE);
	const eventId = generateId();
	const actor = { login: "contributor", avatarUrl: null };
	const normalized =
		kind === "comment.created"
			? {
					kind,
					actor,
					comment: { externalId: eventId, subjectNumber: number },
				}
			: { kind, actor };
	await db.insert(events).values({
		id: eventId,
		deliveryId: `d-${eventId}`,
		rawKind: kind === "comment.created" ? "issue_comment" : "pull_request",
		raw: {},
		kind,
		repoFullName: REPO,
		subjectNumber: number,
		normalized,
		normalizedAt: at,
		receivedAt: at,
	});
	const id = generateId();
	await db.insert(runs).values({
		id,
		eventId,
		repoFullName: REPO,
		subjectNumber: number,
		headSha: kind === "comment.created" ? null : `sha-${step}`,
		status: "completed",
		verdict,
		workflowSnapshot: [],
		createdAt: at,
		backfill: options.backfill ?? false,
	});
	return id;
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("a comment run between two blocks (staging PR 135)", () => {
	const PR = 135;
	let firstBlock: string;
	let commentRun: string;
	let secondBlock: string;
	let fix: string;

	beforeAll(async () => {
		firstBlock = await seedRun(PR, "change-request.opened", "block");
		commentRun = await seedRun(PR, "comment.created", "pass");
		secondBlock = await seedRun(PR, "change-request.updated", "block");
	});

	test("the second block sees block as the verdict on the change request", async () => {
		expect(await getPreviousVerdict(db, REPO, PR, secondBlock)).toBe("block");
	});

	test("the comment run is not in the chain, so the second block replaces the first", async () => {
		const chain = await listRunsForChangeRequest(db, REPO, PR);
		expect(chain.map((row) => row.id)).toEqual([firstBlock, secondBlock]);
		expect(await getLatestRunIdForChangeRequest(db, REPO, PR)).toBe(
			secondBlock,
		);
	});

	test("activity reads block as the change request's verdict", async () => {
		await seedRun(PR, "comment.created", "pass");
		const feed = await listActivityFeed(db, { repoFullName: REPO });
		const group = feed.items.find(
			(item) => item.type === "group" && item.group.subjectNumber === PR,
		);
		expect(group?.type === "group" && group.group.currentVerdict).toBe("block");
		expect(group?.type === "group" && group.group.currentRunId).toBe(
			secondBlock,
		);
	});

	test("a later block on the change request is still open after a comment", async () => {
		const rows = await listOpenBlockedRuns(db, REPO, new Date(start - MINUTE));
		expect(rows.map((row) => row.runId)).toContain(secondBlock);
	});

	test("the fix push sees block as the verdict it clears", async () => {
		fix = await seedRun(PR, "change-request.updated", "pass");
		expect(await getPreviousVerdict(db, REPO, PR, fix)).toBe("block");
		expect(commentRun).not.toBe(fix);
	});

	test("comment runs do not count toward verdict metrics", async () => {
		const recent = await listRecentRuns(db, {
			repoFullName: REPO,
			verdicts: ["pass"],
		});
		expect(recent.map((row) => row.runId)).toEqual([fix]);
	});
});

describe("control: two blocks then a fix with no comment (staging PR 136)", () => {
	const PR = 136;

	test("block, block, pass read as one transition", async () => {
		const first = await seedRun(PR, "change-request.opened", "block");
		expect(await getPreviousVerdict(db, REPO, PR, first)).toBeNull();
		const second = await seedRun(PR, "change-request.updated", "block");
		expect(await getPreviousVerdict(db, REPO, PR, second)).toBe("block");
		const fix = await seedRun(PR, "change-request.updated", "pass");
		expect(await getPreviousVerdict(db, REPO, PR, fix)).toBe("block");
		const chain = await listRunsForChangeRequest(db, REPO, PR);
		expect(chain.map((row) => row.id)).toEqual([first, second, fix]);
	});
});

describe("a backfill run on a change request (R7-1)", () => {
	const PR = 137;

	test("the chain holds live runs only, so a backfill run is never previous or latest", async () => {
		const live = await seedRun(PR, "change-request.opened", "block");
		await seedRun(PR, "change-request.updated", "needs_review", {
			backfill: true,
		});
		const chain = await listRunsForChangeRequest(db, REPO, PR);
		expect(chain.map((row) => row.id)).toEqual([live]);
	});
});

const TRIGGER_ONLY: WorkflowDefinition = {
	id: "wf-trigger",
	name: "Trigger only",
	version: 1,
	nodes: [{ id: "t", type: "trigger", kinds: ["change-request.updated"] }],
	edges: [],
};

describe("a slow run for an older event (same-head retarget)", () => {
	const PR = 260;

	async function seedEvent(at: Date): Promise<string> {
		const eventId = generateId();
		await db.insert(events).values({
			id: eventId,
			deliveryId: `d-${eventId}`,
			rawKind: "pull_request",
			raw: {},
			kind: "change-request.updated",
			repoFullName: REPO,
			subjectNumber: PR,
			normalized: { kind: "change-request.updated" },
			normalizedAt: at,
			receivedAt: at,
		});
		return eventId;
	}

	async function seedRunFor(
		eventId: string,
		verdict: "pass" | "block",
		createdAt: Date,
	): Promise<string> {
		const id = generateId();
		await db.insert(runs).values({
			id,
			eventId,
			repoFullName: REPO,
			subjectNumber: PR,
			headSha: "same-head",
			status: "completed",
			verdict,
			workflowSnapshot: [],
			createdAt,
		});
		return id;
	}

	test("the run for the newer event stays latest when the older one finishes last", async () => {
		const t0 = Date.now() - 10 * MINUTE;
		const pushed = await seedEvent(new Date(t0));
		const retargeted = await seedEvent(new Date(t0 + MINUTE));
		const fresh = await seedRunFor(
			retargeted,
			"pass",
			new Date(t0 + 2 * MINUTE),
		);
		const stale = await seedRunFor(pushed, "block", new Date(t0 + 3 * MINUTE));

		expect(await getLatestRunIdForChangeRequest(db, REPO, PR)).toBe(fresh);
		expect(await getLatestRunForChangeRequest(db, REPO, PR)).toEqual({
			id: fresh,
			eventId: retargeted,
			headSha: "same-head",
		});
		expect(await getPreviousVerdict(db, REPO, PR, fresh)).toBe("block");
		expect(await getPreviousVerdict(db, REPO, PR, stale)).toBe("pass");

		const chain = await listRunsForChangeRequest(db, REPO, PR);
		expect(chain.map((row) => row.id)).toEqual([stale, fresh]);
		const open = await listOpenBlockedRuns(db, REPO, new Date(t0 - MINUTE));
		expect(open.map((row) => row.subjectNumber)).not.toContain(PR);
	});

	test("a claimed re-run is rebound to the event it actually evaluates", async () => {
		const t0 = Date.now() - 5 * MINUTE;
		const enqueuedFor = await seedEvent(new Date(t0));
		const claim = await seedRunFor(enqueuedFor, "block", new Date(t0));
		await db
			.update(runs)
			.set({ status: "queued", verdict: null })
			.where(eq(runs.id, claim));
		const edited = await seedEvent(new Date(t0 + MINUTE));
		const editRun = await seedRunFor(edited, "pass", new Date(t0 + MINUTE));
		expect(await getLatestRunIdForChangeRequest(db, REPO, PR)).toBe(editRun);

		await beginRunEvaluation(db, claim, {
			snapshot: [TRIGGER_ONLY],
			headSha: "same-head",
			eventId: edited,
		});
		expect(await getLatestRunIdForChangeRequest(db, REPO, PR)).toBe(claim);

		await finalizeRun(db, claim, {
			eventId: edited,
			headSha: "same-head",
			snapshot: [TRIGGER_ONLY],
			status: "completed",
			verdict: "block",
		});
		expect(await getLatestRunForChangeRequest(db, REPO, PR)).toEqual({
			id: claim,
			eventId: edited,
			headSha: "same-head",
		});
	});

	test("a re-run of the newest event outranks the run it repeats", async () => {
		const latest = await getLatestRunForChangeRequest(db, REPO, PR);
		if (!latest) {
			throw new Error("no latest run");
		}
		const rerun = await seedRunFor(latest.eventId, "block", new Date());
		expect(await getLatestRunIdForChangeRequest(db, REPO, PR)).toBe(rerun);
	});
});
