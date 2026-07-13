import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	repoServices,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import { loadRunView } from "#/lib/server/run-view";

/**
 * §10 access model over a REAL Postgres: a no-session read of a public-repo
 * run returns the judgment (verdict + findings) without the ai-review trace;
 * private and unknown repos gate to nothing without a session.
 */
let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let publicRunId: string;
let privateRunId: string;
let orphanRunId: string;

const NO_SESSION = { authEnabled: true, userId: null };
const SESSION = { authEnabled: true, userId: "user-1" };
const OPEN_DEV = { authEnabled: false, userId: null };

const AI_REVIEW_ENVELOPE = {
	ruleId: "ai-review",
	version: 1,
	status: "evaluated",
	passed: false,
	evaluatedAt: "2026-07-11T00:00:00.000Z",
	evidence: {
		output: {
			verdict: "block",
			confidence: 1,
			summary: "exfiltrates tokens in ci.",
			findings: [
				{
					severity: "critical",
					file: ".github/workflows/ci.yml",
					line: 12,
					note: "posts secrets to an external host",
				},
			],
		},
		trace: { steps: 4, tokens: 9000 },
	},
};

async function seedRun(repoFullName: string): Promise<string> {
	const runId = await runServices.createRun(db, {
		eventId: "evt-run-view-1",
		repoFullName,
		subjectNumber: 7,
		headSha: "abc1234def",
		snapshot: [DEFAULT_WORKFLOW],
		status: "completed",
		verdict: "block",
	});
	await runServices.recordSteps(db, runId, [
		{
			nodeId: "default@1:ai-review-1",
			nodeKind: "rule",
			ruleRef: "ai-review@1",
			status: "failed",
			input: null,
			output: AI_REVIEW_ENVELOPE,
			// §10 — the worker stores the rule-projected public partition; seed
			// it directly here (findings public, trace gated) + the one-liner.
			publicEvidence: { output: AI_REVIEW_ENVELOPE.evidence.output },
			summary: "exfiltrates tokens in ci.",
			startedAt: "2026-07-11T00:00:00.000Z",
			finishedAt: "2026-07-11T00:00:01.000Z",
			durationMs: 1000,
		},
		{
			nodeId: "run:deny-floor",
			nodeKind: "action",
			status: "pass",
			input: { decision: "deny", pausedNodeId: "default@1:mod" },
			output: { rule: "deny (no deny edge) → block by default" },
			startedAt: "2026-07-11T00:00:01.000Z",
			finishedAt: "2026-07-11T00:00:01.000Z",
			durationMs: 0,
		},
	]);
	return runId;
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);

	await pool.query(
		`INSERT INTO events (id, delivery_id, raw_kind, raw)
		 VALUES ('evt-run-view-1', 'run-view-1', 'pull_request', '{}')`,
	);
	await repoServices.syncInstallationRepos(
		db,
		"inst-1",
		[
			{
				externalId: "101",
				owner: "acme",
				name: "pub",
				fullName: "acme/pub",
				private: false,
			},
			{
				externalId: "102",
				owner: "acme",
				name: "priv",
				fullName: "acme/priv",
				private: true,
			},
		],
		[],
	);
	publicRunId = await seedRun("acme/pub");
	privateRunId = await seedRun("acme/priv");
	orphanRunId = await seedRun("ghost/none");
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("loadRunView — §10 access model", () => {
	test("no session + public repo ⇒ verdict + findings, no trace, no snapshot", async () => {
		const view = await loadRunView(db, publicRunId, NO_SESSION);
		if (!view) {
			throw new Error("expected the public view");
		}
		expect(view.access).toBe("public");
		expect(view.verdict).toBe("block");
		expect(view.steps).toHaveLength(2);
		const serialized = JSON.stringify(view);
		expect(serialized).toContain("posts secrets to an external host");
		expect(serialized).not.toContain("trace");
		expect(view.snapshot).toBeNull();
		// §10 — the public view carries the rule's plain-English one-liner.
		expect(view.steps[0]?.summary).toBe("exfiltrates tokens in ci.");
	});

	test("session ⇒ full view, trace intact, summary kept, no publicEvidence carrier", async () => {
		const view = await loadRunView(db, publicRunId, SESSION);
		expect(view?.access).toBe("full");
		expect(JSON.stringify(view)).toContain("trace");
		expect(view?.snapshot).not.toBeNull();
		// the plain-English summary rides along (the run page renders it); only the
		// publicEvidence carrier is stripped from the session view.
		expect(view?.steps[0]?.summary).toBe("exfiltrates tokens in ci.");
		expect(view?.steps[0]?.publicEvidence).toBeUndefined();
	});

	test("open-dev posture ⇒ full view", async () => {
		const view = await loadRunView(db, publicRunId, OPEN_DEV);
		expect(view?.access).toBe("full");
	});

	test("no session + private repo ⇒ nothing (indistinguishable from missing)", async () => {
		expect(await loadRunView(db, privateRunId, NO_SESSION)).toBeNull();
		expect((await loadRunView(db, privateRunId, SESSION))?.access).toBe("full");
	});

	test("no session + repo row missing ⇒ nothing (fail closed)", async () => {
		expect(await loadRunView(db, orphanRunId, NO_SESSION)).toBeNull();
	});

	test("unknown run id ⇒ null", async () => {
		expect(
			await loadRunView(db, "019f0000-0000-7000-8000-000000000000", SESSION),
		).toBeNull();
	});
});
