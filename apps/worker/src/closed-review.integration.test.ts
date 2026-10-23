import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	moderationServices,
	runServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import type { ForgeAction, ForgeAdapter } from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import pullRequestClosed from "../../../packages/forge-github/fixtures/pull_request.closed.json";
import { staticForge } from "./forge-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });
const executed: ForgeAction[] = [];

const adapter: ForgeAdapter = {
	forge: "github",
	verifyWebhook: () => true,
	normalizeWebhook: () => null,
	getDiff: () => Promise.reject(new Error("unused")),
	getCommits: () => Promise.reject(new Error("unused")),
	readFile: () => Promise.resolve(null),
	getContributorProfile: () => Promise.reject(new Error("unused")),
	execute: (action) => {
		executed.push(action);
		return Promise.resolve({ externalId: "check-1" });
	},
};

const REPO = pullRequestClosed.repository.full_name;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function waitingRun(id: string, number: number, sha: string) {
	await db.insert(schema.events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.opened",
		repoFullName: REPO,
		subjectNumber: number,
	});
	const runId = await runServices.createRun(db, {
		eventId: id,
		repoFullName: REPO,
		subjectNumber: number,
		headSha: sha,
		snapshot: [DEFAULT_WORKFLOW],
		status: "paused",
		verdict: "needs_review",
	});
	await moderationServices.createModerationItem(db, {
		runId,
		nodeId: "default@1:review",
	});
	const [row] = await runServices.recordActions(db, runId, [
		{
			kind: "set-check",
			payload: {
				sha,
				conclusion: "pending",
				summary: "Waiting for human review.",
				detailsUrl: `http://localhost:3000/runs/${runId}`,
			},
			idempotencyKey: `check:${sha}:needs_review`,
		},
	]);
	if (row) {
		await runServices.markActionExecuted(db, row.id, "check-1");
	}
	return runId;
}

function neutralChecks() {
	return executed.flatMap((action) =>
		action.kind === "set-check" && action.check.conclusion === "neutral"
			? [action.check]
			: [],
	);
}

describe("closing a change request while it waits for human review", () => {
	test("the run closes and the check stops waiting", async () => {
		const sha = pullRequestClosed.pull_request.head.sha;
		const runId = await waitingRun(
			"closed-open",
			pullRequestClosed.number,
			sha,
		);
		executed.length = 0;
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "closed-1",
			rawKind: "pull_request",
			raw: pullRequestClosed,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(
			{
				db,
				pool,
				logger,
				resolveForge: staticForge({ adapter }),
				makeGenerate: null,
				appUrl: "http://localhost:3000",
				selfLogins: new Set(),
			},
			{ eventId },
		);

		expect((await runServices.getRunById(db, runId))?.status).toBe("closed");
		expect(neutralChecks()).toEqual([
			{
				sha,
				conclusion: "neutral",
				summary: "Closed before review.",
				detailsUrl: `http://localhost:3000/runs/${runId}`,
			},
		]);
		const actions = await runServices.listRunActions(db, runId);
		expect(
			actions.filter(
				(action) => action.kind === "set-check" && action.status === "executed",
			),
		).toHaveLength(2);
	});
});

describe("the sweep closes reviews left waiting on closed change requests", () => {
	test("a run whose change request closed before this fix closes, and its check too", async () => {
		const sha = "c".repeat(40);
		const runId = await waitingRun("leftover-open", 140, sha);
		await db.insert(schema.events).values({
			id: "leftover-closed",
			deliveryId: "d-leftover-closed",
			rawKind: "pull_request",
			raw: {},
			kind: "change-request.closed",
			repoFullName: REPO,
			subjectNumber: 140,
		});
		executed.length = 0;

		await sweepActions({
			db,
			adapterFor: () => Promise.resolve(adapter),
			logger,
		});

		expect((await runServices.getRunById(db, runId))?.status).toBe("closed");
		expect(neutralChecks().map((check) => check.sha)).toEqual([sha]);
		expect(await moderationServices.listPendingItems(db, REPO)).toHaveLength(0);
	});
});
