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
import * as insightServices from "./insights.ts";
import {
	createRun,
	markActionExecuted,
	recordActions,
	recordSteps,
} from "./runs.ts";

/**
 * §9 rules-page stats over REAL stored data — repo-scoped, no new pipeline.
 * Proves matches come from rule-node fails, actioned counts only executed
 * enforcement kinds (never the always-emitted comment/check), and one repo's
 * activity never leaks into another's numbers.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
const SNAPSHOT = [DEFAULT_WORKFLOW];

async function seedEvent(id: string, repoFullName: string): Promise<string> {
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		repoFullName,
	});
	return id;
}

async function seedRun(
	eventId: string,
	repoFullName: string,
	failedRefs: string[],
	enforcement: string[],
): Promise<string> {
	const runId = await createRun(db, {
		eventId,
		repoFullName,
		subjectNumber: 1,
		headSha: `sha-${eventId}`,
		snapshot: SNAPSHOT,
		status: "completed",
		verdict: "block",
	});
	const at = new Date().toISOString();
	await recordSteps(
		db,
		runId,
		failedRefs.map((ref, i) => ({
			nodeId: `default@1:rule-${i}`,
			nodeKind: "rule",
			ruleRef: ref,
			status: "fail",
			input: {},
			output: {
				ruleId: ref.split("@")[0],
				version: 1,
				status: "evaluated",
				passed: false,
				evidence: {},
				evaluatedAt: at,
			},
			startedAt: at,
			finishedAt: at,
			durationMs: 0,
		})),
	);
	const rows = await recordActions(
		db,
		runId,
		[...enforcement, "comment", "set-check"].map((kind, i) => ({
			kind,
			payload: {},
			idempotencyKey: `${kind}:${i}`,
		})),
	);
	for (const row of rows) {
		await markActionExecuted(db, row.id, null);
	}
	return runId;
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("getRulesStats — repo-scoped, real stored data", () => {
	test("matches from rule fails; actioned counts enforcement only, not comment/check", async () => {
		const eA = await seedEvent("evt-a", "acme/alpha");
		await seedRun(eA, "acme/alpha", ["account-age@1", "honeypot@1"], ["block"]);
		const eB = await seedEvent("evt-b", "acme/beta");
		await seedRun(eB, "acme/beta", ["crypto-address@1"], ["block", "label"]);

		const alpha = await insightServices.getRulesStats(db, "acme/alpha");
		expect(alpha.matches24h.value).toBe(2);
		// block executed, but the comment + set-check rows must NOT count.
		expect(alpha.actioned24h.value).toBe(1);
		expect(alpha.matches24h.series).toHaveLength(24);

		const byRef = new Map(alpha.perRule.map((r) => [r.ref, r]));
		expect(byRef.get("account-age@1")?.matches24h).toBe(1);
		expect(byRef.get("honeypot@1")?.matches24h).toBe(1);
		// beta's rule never appears in alpha's per-rule breakdown.
		expect(byRef.has("crypto-address@1")).toBe(false);

		const beta = await insightServices.getRulesStats(db, "acme/beta");
		expect(beta.matches24h.value).toBe(1);
		expect(beta.actioned24h.value).toBe(2);
	});

	test("a repo with no runs reports honest zeros", async () => {
		const empty = await insightServices.getRulesStats(db, "acme/nobody");
		expect(empty.matches24h.value).toBe(0);
		expect(empty.actioned24h.value).toBe(0);
		expect(empty.perRule).toHaveLength(0);
	});
});
