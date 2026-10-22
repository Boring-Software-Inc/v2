import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type NormalizedEvent,
	normalizedEventSchema,
	REVIEW_POINTER,
	responseConfigSchema,
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
	repoServices,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import type { ForgeAction } from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { staticForge } from "./forge-runtime.ts";
import { emitPrSurface } from "./jobs/pr-surface.ts";
import { refreshRepoSurfaces } from "./jobs/refresh-surfaces.ts";

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
			{
				kind: "block",
				repoFullName: REPO,
				number: 5,
				reason: REVIEW_POINTER.block,
			},
			{
				kind: "update-review",
				repoFullName: REPO,
				number: 5,
				reviewId: "rev-1",
				reason: REVIEW_POINTER.block,
			},
		]);

		const second = await run("block");
		expect(second).toEqual([
			{
				kind: "update-review",
				repoFullName: REPO,
				number: 5,
				reviewId: "rev-1",
				reason: REVIEW_POINTER.block,
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
			{
				kind: "block",
				repoFullName: REPO,
				number: 5,
				reason: REVIEW_POINTER.block,
			},
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

const REVIEW_KINDS = new Set([
	"block",
	"update-review",
	"dismiss-review",
	"comment",
	"delete-comment",
]);

async function harness(repo: string, number: number, level: number) {
	const base = await baseEvent();
	if (!("changeRequest" in base)) {
		throw new Error("fixture is not a change request");
	}
	const repoId = await repoServices.ensureRepo(db, {
		externalId: `ext-${repo}`,
		owner: repo.split("/")[0] ?? "acme",
		name: repo.split("/")[1] ?? "repo",
		fullName: repo,
	});
	const setLevel = (next: number) =>
		repoServices.upsertResponseConfig(
			db,
			repoId,
			responseConfigSchema.parse({
				redaction: { inherit: false, level: next },
			}),
		);
	await setLevel(level);
	const fake = fakeAdapter();
	const deps = {
		db,
		adapter: fake.adapter as never,
		logger,
		appUrl: "https://tripwire.sh",
	};
	let push = 0;
	const since = () => {
		const before = fake.executed.length;
		return () =>
			fake.executed.slice(before).filter((a) => REVIEW_KINDS.has(a.kind));
	};
	const run = async (verdict: Verdict) => {
		push++;
		const sha = `${number}${push}`.padEnd(40, "0");
		const event = {
			...base,
			repo: { ...base.repo, fullName: repo },
			changeRequest: { ...base.changeRequest, number, headSha: sha },
		} as NormalizedEvent;
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: `${repo}-${push}`,
			rawKind: "pull_request",
			raw: { action: "synchronize" },
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await eventServices.markEventNormalized(db, pool, eventId, event);
		const runId = await runServices.createRun(db, {
			eventId,
			repoFullName: repo,
			subjectNumber: number,
			headSha: sha,
			snapshot: SNAPSHOT,
			status: "completed",
			verdict,
		});
		if (verdict === "block") {
			const at = new Date().toISOString();
			await runServices.recordSteps(db, runId, [
				{
					nodeId: "w:max-files",
					nodeKind: "rule",
					ruleRef: "max-files-changed@1",
					status: "fail",
					input: null,
					output: {
						ruleId: "max-files-changed",
						version: 1,
						status: "evaluated",
						passed: false,
						evidence: { filesChanged: 40, max: 10 },
						evaluatedAt: at,
					},
					startedAt: at,
					finishedAt: at,
					durationMs: 1,
				},
			]);
		}
		const rows =
			verdict === "block"
				? await runServices.recordActions(db, runId, [
						{
							kind: "block",
							payload: { nodeId: "w:block" },
							idempotencyKey: "block:w:block",
						},
					])
				: [];
		const after = since();
		await emitPrSurface(deps, {
			runId,
			verdict,
			event,
			reasons:
				verdict === "block"
					? [
							{
								text: "It changes 40 files.",
								remedy: "revise",
								ruleId: "max-files-changed",
								ruleName: "Max files changed",
							},
							{
								text: "Target branch is main.",
								remedy: "revise",
								ruleId: "custom-doesnt-go-to-main-019fa6",
								ruleName: "Doesn't go to main",
							},
						]
					: [],
			pendingActionRows: rows.map((row) => ({
				id: row.id,
				kind: "block",
				payload: { nodeId: "w:block" },
			})),
		});
		await sleep(15);
		return after();
	};
	let jobs = 0;
	const refresh = async (next: number) => {
		await setLevel(next);
		const after = since();
		jobs++;
		await refreshRepoSurfaces(
			{
				db,
				logger,
				appUrl: "https://tripwire.sh",
				resolveForge: staticForge({ adapter: fake.adapter as never }),
			},
			{ repoId: repoId },
			`job-${repo}-${jobs}`,
		);
		return after();
	};
	return { run, refresh };
}

function reviewBodyOf(actions: ForgeAction[]): string {
	const review = actions.find(
		(a) => a.kind === "block" || a.kind === "update-review",
	);
	return review && "reason" in review ? review.reason : "";
}

describe("high redaction: one review, no comment", () => {
	test("block, block, pass, block at level 6", async () => {
		const { run } = await harness("acme/quiet", 9, 6);

		const first = await run("block");
		expect(first.map((a) => a.kind)).toEqual(["block", "delete-comment"]);
		const body = reviewBodyOf(first);
		expect(body).toContain(
			"@Codertocat, Tripwire blocked this change request.",
		);
		expect(body).toContain("2 rules did not pass.");
		expect(body).toContain('alt="View on Tripwire"');
		expect(body).toContain("How do I fix this?");
		expect(body).not.toContain("See the comment");
		expect(body).not.toContain("Max files changed");

		const second = await run("block");
		expect(second.map((a) => a.kind)).toEqual([
			"update-review",
			"delete-comment",
		]);
		const runLinks = /runs\/[^"]+/g;
		expect(reviewBodyOf(second).replace(runLinks, "")).toBe(
			body.replace(runLinks, ""),
		);
		expect(reviewBodyOf(second)).not.toBe(body);

		const cleared = await run("pass");
		expect(cleared.map((a) => a.kind)).toEqual(["comment", "dismiss-review"]);
		const passComment = cleared.find((a) => a.kind === "comment");
		expect(passComment).toMatchObject({ onlyIfPresent: true });

		const again = await run("block");
		expect(again.map((a) => a.kind)).toEqual(["block", "delete-comment"]);
		expect(reviewBodyOf(again)).toContain(
			"@Codertocat, Tripwire now blocks this change request.",
		);
	});

	test("level 5 names the rules by their display names", async () => {
		const { run } = await harness("acme/names", 10, 5);
		const first = await run("block");
		const body = reviewBodyOf(first);
		expect(body).toContain(
			"2 rules did not pass: Max files changed and Doesn't go to main.",
		);
		expect(body).not.toContain("custom-doesnt-go-to-main");
	});
});

describe("a redaction level change on an open block", () => {
	test("going up deletes the comment, going down posts it again", async () => {
		const { run, refresh } = await harness("acme/levels", 11, 0);

		const first = await run("block");
		expect(first.map((a) => a.kind)).toEqual(["block", "comment"]);
		expect(reviewBodyOf(first)).toBe(REVIEW_POINTER.block);

		const up = await refresh(6);
		expect(up.map((a) => a.kind)).toEqual(["delete-comment", "update-review"]);
		expect(reviewBodyOf(up)).toContain("1 rule did not pass.");
		expect(reviewBodyOf(up)).not.toContain("See the comment");

		const down = await refresh(0);
		expect(down.map((a) => a.kind)).toEqual(["comment", "update-review"]);
		const comment = down.find((a) => a.kind === "comment");
		expect(comment).toMatchObject({
			verdict: "block",
			previousVerdict: "block",
		});
		expect(comment && "body" in comment ? comment.body : "").toContain(
			"**Max files changed:** It changes 40 files. Split it into smaller change requests.",
		);
		expect(reviewBodyOf(down)).toBe(REVIEW_POINTER.block);
	});
});
