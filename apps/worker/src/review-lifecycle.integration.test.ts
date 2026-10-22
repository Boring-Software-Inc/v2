import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type NormalizedEvent,
	normalizedEventSchema,
	REVIEW_BODY,
	type Verdict,
} from "@tripwire/contracts";
import { deriveDefaultWorkflow } from "@tripwire/core";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import type { ForgeAction } from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { emitPrSurface } from "./jobs/pr-surface.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });
const SNAPSHOT = [deriveDefaultWorkflow([])];
const REPO = "acme/reviews";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function fakeAdapter() {
	const executed: ForgeAction[] = [];
	let posted = 0;
	return {
		executed,
		adapter: {
			forge: "github" as const,
			verifyWebhook: () => true,
			normalizeWebhook: () => null,
			getDiff: () => Promise.resolve([]),
			getCommits: () => Promise.resolve([]),
			readFile: () => Promise.resolve(null),
			getContributorProfile: () => Promise.reject(new Error("unused")),
			execute: (action: ForgeAction) => {
				executed.push(action);
				if (action.kind === "block") {
					posted++;
					return Promise.resolve({ externalId: `rev-${posted}` });
				}
				if (
					action.kind === "update-review" ||
					action.kind === "dismiss-review"
				) {
					return Promise.resolve({ externalId: action.reviewId });
				}
				return Promise.resolve({ externalId: `ext-${executed.length}` });
			},
		},
	};
}

async function baseEvent(): Promise<NormalizedEvent> {
	return normalizedEventSchema.parse(
		await Bun.file(
			new URL(
				"../../../packages/core/fixtures/change-request.opened.event.json",
				import.meta.url,
			).pathname,
		).json(),
	);
}

describe("the request-changes review lives once per block", () => {
	test("block, block, pass, block, human review", async () => {
		const base = await baseEvent();
		if (!("changeRequest" in base)) {
			throw new Error("fixture is not a change request");
		}
		const fake = fakeAdapter();
		const deps = {
			db,
			adapter: fake.adapter as never,
			logger,
			appUrl: "https://tripwire.sh",
		};
		let push = 0;
		const run = async (verdict: Verdict, blockRows = 1) => {
			push++;
			const sha = String(push).repeat(40);
			const event = {
				...base,
				repo: { ...base.repo, fullName: REPO },
				changeRequest: { ...base.changeRequest, number: 5, headSha: sha },
			} as NormalizedEvent;
			const { eventId } = await eventServices.insertRawEvent(pool, boss, {
				deliveryId: `review-${push}`,
				rawKind: "pull_request",
				raw: { action: "synchronize" },
			});
			if (!eventId) {
				throw new Error("insert failed");
			}
			const runId = await runServices.createRun(db, {
				eventId,
				repoFullName: REPO,
				subjectNumber: 5,
				headSha: sha,
				snapshot: SNAPSHOT,
				status: "completed",
				verdict,
			});
			const rows =
				verdict === "block"
					? await runServices.recordActions(
							db,
							runId,
							Array.from({ length: blockRows }, (_, index) => ({
								kind: "block",
								payload: { nodeId: `w:block-${index}` },
								idempotencyKey: `block:w:block-${index}`,
							})),
						)
					: [];
			const before = fake.executed.length;
			await emitPrSurface(deps, {
				runId,
				verdict,
				event,
				reasons:
					verdict === "block"
						? [{ text: "It changes 40 files.", remedy: "revise" }]
						: [],
				pendingActionRows: rows.map((row) => ({
					id: row.id,
					kind: "block",
					payload: { nodeId: "w:block" },
				})),
			});
			await sleep(15);
			return fake.executed
				.slice(before)
				.filter(
					(action) =>
						action.kind === "block" ||
						action.kind === "update-review" ||
						action.kind === "dismiss-review",
				);
		};

		const first = await run("block", 2);
		expect(first).toEqual([
			{ kind: "block", repoFullName: REPO, number: 5, reason: REVIEW_BODY },
			{
				kind: "update-review",
				repoFullName: REPO,
				number: 5,
				reviewId: "rev-1",
				reason: REVIEW_BODY,
			},
		]);

		const second = await run("block");
		expect(second).toEqual([
			{
				kind: "update-review",
				repoFullName: REPO,
				number: 5,
				reviewId: "rev-1",
				reason: REVIEW_BODY,
			},
		]);

		const cleared = await run("pass");
		expect(cleared).toEqual([
			{
				kind: "dismiss-review",
				repoFullName: REPO,
				number: 5,
				reviewId: "rev-1",
			},
		]);

		const again = await run("block");
		expect(again).toEqual([
			{ kind: "block", repoFullName: REPO, number: 5, reason: REVIEW_BODY },
		]);
		expect(await runServices.getActiveBlockReviewId(db, REPO, 5)).toBe("rev-2");

		const review = await run("needs_review");
		expect(review).toEqual([
			{
				kind: "dismiss-review",
				repoFullName: REPO,
				number: 5,
				reviewId: "rev-2",
			},
		]);
		expect(await runServices.getActiveBlockReviewId(db, REPO, 5)).toBeNull();

		const posted = fake.executed.filter((action) => action.kind === "block");
		expect(posted).toHaveLength(2);
	});
});
