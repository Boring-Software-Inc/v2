import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { actionCommentMarker } from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	repoServices,
	type TestDatabase,
	workflowServices,
} from "@tripwire/db";
import type { ForgeAction } from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import issueComment from "../../../packages/forge-github/fixtures/issue_comment.created.json";
import pullRequestClosed from "../../../packages/forge-github/fixtures/pull_request.closed.json";
import { staticForge } from "./forge-runtime.ts";
import { isSelfEvent, processEvent } from "./jobs/process-event.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });
const exemptionBefore = process.env.TRIPWIRE_DISABLE_EXEMPTION;
const SELF = "tripwire-dev[bot]";
const executed: ForgeAction[] = [];

const resolveForge = staticForge({
	adapter: {
		forge: "github",
		verifyWebhook: () => true,
		normalizeWebhook: () => null,
		getDiff: () => Promise.reject(new Error("unused")),
		getCommits: () => Promise.reject(new Error("unused")),
		readFile: () => Promise.resolve(null),
		getContributorProfile: () => Promise.reject(new Error("unused")),
		execute: (action) => {
			executed.push(action);
			return Promise.resolve({ externalId: null });
		},
	},
});

beforeAll(async () => {
	delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	const repoId = await repoServices.ensureRepo(db, {
		externalId: String(issueComment.repository.id),
		owner: issueComment.repository.owner.login,
		name: issueComment.repository.name,
		fullName: issueComment.repository.full_name,
		installationId: "2311213",
	});
	await repoServices.setRepoArmed(db, repoId, true);
	const row = await workflowServices.createWorkflow(db, {
		repoId,
		name: "Reset stale",
		definition: {
			id: "wf-reset",
			name: "Reset stale",
			version: 1,
			nodes: [
				{
					id: "reset",
					type: "trigger",
					kinds: ["comment.created", "change-request.closed"],
				},
				{
					id: "unmark",
					type: "action",
					action: "remove-label",
					params: { labels: ["stale"] },
				},
			],
			edges: [{ id: "e1", from: "reset", to: "unmark" }],
		},
	});
	const enabled = await workflowServices.setWorkflowEnabled(db, {
		repoId,
		workflowId: row.id,
		enabled: true,
	});
	expect(enabled.ok).toBe(true);
}, 120_000);

afterAll(async () => {
	if (exemptionBefore === undefined) {
		delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	} else {
		process.env.TRIPWIRE_DISABLE_EXEMPTION = exemptionBefore;
	}
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

const BOT_SENDER = {
	...pullRequestClosed.sender,
	login: SELF,
	id: 150000001,
	type: "Bot",
};

function tripwireComment(body: string) {
	return {
		...issueComment,
		sender: BOT_SENDER,
		comment: {
			...issueComment.comment,
			body,
			user: BOT_SENDER,
			performed_via_github_app: { id: 3169732, slug: "tripwire-dev" },
		},
	};
}

async function deliver(
	deliveryId: string,
	rawKind: string,
	raw: unknown,
): Promise<number> {
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId,
		rawKind,
		raw,
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
	await processEvent(
		{
			db,
			pool,
			logger,
			resolveForge,
			makeGenerate: null,
			appUrl: "http://localhost:3000",
			selfLogins: new Set([SELF]),
		},
		{ eventId },
	);
	const runs = await pool.query(
		"SELECT count(*)::int AS n FROM runs WHERE event_id = $1",
		[eventId],
	);
	return runs.rows[0].n;
}

describe("events tripwire caused itself", () => {
	test("a contributor's comment runs the workflow", async () => {
		expect(await deliver("self-1", "issue_comment", issueComment)).toBe(1);
		expect(executed.map((action) => action.kind)).toContain("remove-label");
	});

	test("tripwire's own workflow comment does not", async () => {
		const marked = tripwireComment(
			`This change request has had no activity for 3 weeks.\n\n${actionCommentMarker(
				{ workflowId: "wf-stale", nodeId: "warn", runId: "run-1" },
			)}`,
		);
		expect(await deliver("self-2", "issue_comment", marked)).toBe(0);
	});

	test("tripwire's verdict comment does not", async () => {
		const verdict = tripwireComment("Blocked.\n\n<!-- tripwire:run -->");
		expect(await deliver("self-3", "issue_comment", verdict)).toBe(0);
	});

	test("a contributor's comment that copies the marker still runs", async () => {
		const spoofed = {
			...issueComment,
			comment: {
				...issueComment.comment,
				body: "Buy now.\n\n<!-- tripwire:run -->",
			},
		};
		expect(await deliver("self-3b", "issue_comment", spoofed)).toBe(1);
	});

	test("a close by the tripwire app does not", async () => {
		expect(
			await deliver("self-4", "pull_request", {
				...pullRequestClosed,
				sender: BOT_SENDER,
			}),
		).toBe(0);
	});

	test("a close by a person does", async () => {
		expect(await deliver("self-5", "pull_request", pullRequestClosed)).toBe(1);
	});
});

describe("isSelfEvent", () => {
	test("matches the app login without case and ignores schedules", () => {
		const base = {
			id: "e",
			forge: "github" as const,
			deliveryId: "d",
			repo: { owner: "o", name: "r", fullName: "o/r" },
			occurredAt: "2026-10-01T00:00:00.000Z",
			receivedAt: "2026-10-01T00:00:00.000Z",
		};
		const push = {
			...base,
			kind: "push" as const,
			actor: { login: "Tripwire-Dev[bot]", externalId: "1" },
			push: { ref: "refs/heads/main", headSha: "a".repeat(40), commitCount: 1 },
		};
		expect(isSelfEvent(push, new Set([SELF]))).toBe(true);
		expect(isSelfEvent(push, new Set())).toBe(false);
		expect(
			isSelfEvent(
				{
					...base,
					kind: "schedule.matched",
					actor: { login: SELF, externalId: "1" },
					schedule: { workflowId: "w", nodeId: "n", tickId: "t" },
					thread: {
						kind: "issue",
						number: 1,
						title: "t",
						url: "u",
						state: "open",
						author: SELF,
						labels: [],
						locked: false,
						updatedAt: "2026-09-01T00:00:00.000Z",
					},
				},
				new Set([SELF]),
			),
		).toBe(false);
	});
});
