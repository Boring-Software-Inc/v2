import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	orgServices,
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
const OUTSIDER = { authEnabled: true, userId: "user-2" };
const OPEN_DEV = { authEnabled: false, userId: null };
const BUILDER = { authEnabled: true, userId: "user-3" };
const OPERATOR = { authEnabled: true, userId: "user-4" };

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
	// The re-run scope hangs off the repo's org, so the install has to be
	// CLAIMED — an unclaimed one syncs its repos with a null org_id and the full
	// view legitimately carries no scope (§10: never auto-attach on a guess).
	// `user-1` deliberately gets no membership: the session view must surface the
	// scope while still refusing the re-run.
	await pool.query(
		`INSERT INTO organization (id, name, slug, is_personal)
		 VALUES ('org-run-view', 'acme', 'acme', false)`,
	);
	await orgServices.linkOrgInstallation(db, {
		orgId: "org-run-view",
		installationId: "inst-1",
	});
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
		await orgServices.getInstallationOrg(db, { installationId: "inst-1" }),
	);
	await pool.query(
		`INSERT INTO "user" (id, name, email) VALUES
		 ('user-1', 'member', 'member@example.com'),
		 ('user-2', 'outsider', 'outsider@example.com'),
		 ('user-3', 'builder', 'builder@example.com'),
		 ('user-4', 'operator', 'operator@example.com')`,
	);
	await pool.query(
		`INSERT INTO organization_role (id, organization_id, role, permission) VALUES
		 ('role-builder', 'org-run-view', 'builder', '{"workflows":["read","manage"]}'),
		 ('role-operator', 'org-run-view', 'operator', '{"activity":["read","manage"]}')`,
	);
	await pool.query(
		`INSERT INTO member (id, organization_id, user_id, role) VALUES
		 ('member-1', 'org-run-view', 'user-1', 'member'),
		 ('member-3', 'org-run-view', 'user-3', 'builder'),
		 ('member-4', 'org-run-view', 'user-4', 'operator')`,
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

	test("org member ⇒ full view, trace intact, summary kept, no publicEvidence carrier", async () => {
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

	test("full view surfaces the re-run scope; public strips it (§6/§10)", async () => {
		const pub = await loadRunView(db, publicRunId, NO_SESSION);
		expect(pub?.orgSlug).toBeNull();
		expect(pub?.repoName).toBeNull();
		expect(pub?.canRerun).toBe(false);

		// A member gets the scope, but user-1 is not an admin ⇒ no re-run.
		const full = await loadRunView(db, publicRunId, SESSION);
		expect(full?.repoName).toBe("pub");
		expect(full?.canRerun).toBe(false);

		// Open-dev posture treats the viewer as admin ⇒ re-run is offered.
		const dev = await loadRunView(db, publicRunId, OPEN_DEV);
		expect(dev?.repoName).toBe("pub");
		expect(dev?.canRerun).toBe(true);
	});

	test("no session + private repo ⇒ nothing (indistinguishable from missing)", async () => {
		expect(await loadRunView(db, privateRunId, NO_SESSION)).toBeNull();
		expect((await loadRunView(db, privateRunId, SESSION))?.access).toBe("full");
	});

	test("signed-in non-member ⇒ the public view, never the full one", async () => {
		const view = await loadRunView(db, publicRunId, OUTSIDER);
		expect(view?.access).toBe("public");
		expect(JSON.stringify(view)).not.toContain("trace");
		expect(await loadRunView(db, privateRunId, OUTSIDER)).toBeNull();
	});

	test("a member whose role has no activity access ⇒ only what an outsider sees", async () => {
		const view = await loadRunView(db, publicRunId, BUILDER);
		expect(view?.access).toBe("public");
		expect(JSON.stringify(view)).not.toContain("trace");
		expect(view?.canRerun).toBe(false);
		expect(await loadRunView(db, privateRunId, BUILDER)).toBeNull();
	});

	test("activity manage, not the admin role, offers the re-run", async () => {
		const view = await loadRunView(db, privateRunId, OPERATOR);
		expect(view?.access).toBe("full");
		expect(view?.canRerun).toBe(true);
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

describe("loadRunView, the chain of events", () => {
	let firstRunId: string;
	let secondRunId: string;

	beforeAll(async () => {
		await pool.query(
			`INSERT INTO events (id, delivery_id, raw_kind, raw, kind, actor_login, subject_number, head_sha, normalized)
			 VALUES ('evt-chain-1', 'chain-1', 'pull_request', '{}', 'change-request.opened', 'contrib', 8, 'aaa1111', '{"occurredAt":"2026-07-11T00:00:00.000Z","changeRequest":{"title":"Add a wallet"}}'),
			        ('evt-chain-2', 'chain-2', 'pull_request', '{}', 'change-request.updated', 'contrib', 8, 'bbb2222', '{}')`,
		);
		firstRunId = await runServices.createRun(db, {
			eventId: "evt-chain-1",
			repoFullName: "acme/pub",
			subjectNumber: 8,
			headSha: "aaa1111",
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "pass",
		});
		secondRunId = await runServices.createRun(db, {
			eventId: "evt-chain-2",
			repoFullName: "acme/pub",
			subjectNumber: 8,
			headSha: "bbb2222",
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "block",
		});
		await pool.query(
			`UPDATE runs SET created_at = created_at + interval '1 minute' WHERE id = $1`,
			[secondRunId],
		);
		const [check] = await runServices.recordActions(db, firstRunId, [
			{ kind: "set-check", payload: {}, idempotencyKey: "check:aaa1111" },
		]);
		if (check) {
			await runServices.markActionExecuted(db, check.id, "9001");
		}
		await pool.query(
			`INSERT INTO moderation_items (id, run_id, node_id, status, decided_at, decided_by)
			 VALUES ('mod-chain-1', $1, 'default@1:mod', 'approved', now(), 'user-1')`,
			[firstRunId],
		);
	});

	test("the event, the newer run and the check link come from the data", async () => {
		const view = await loadRunView(db, firstRunId, SESSION);
		expect(view?.event?.kind).toBe("change-request.opened");
		expect(view?.event?.actor).toBe("contrib");
		expect(view?.event?.title).toBe("Add a wallet");
		expect(view?.nextRun?.id).toBe(secondRunId);
		expect(view?.previousRun).toBeNull();
		expect(view?.actions[0]?.url).toBe("https://github.com/acme/pub/runs/9001");
		expect(view?.workflows).toEqual([
			{ id: "default@1", name: "Rules", outcome: "pass" },
		]);
	});

	test("a later run links back to the run it replaces", async () => {
		const view = await loadRunView(db, secondRunId, NO_SESSION);
		expect(view?.previousRun?.id).toBe(firstRunId);
		expect(view?.nextRun).toBeNull();
	});

	test("members see who decided a review, the public sees only the decision", async () => {
		const member = await loadRunView(db, firstRunId, SESSION);
		expect(member?.reviews[0]?.state).toBe("approved");
		expect(member?.reviews[0]?.workflowId).toBe("default@1");
		expect(member?.reviews[0]?.decidedBy).toBe("member");
		const stranger = await loadRunView(db, firstRunId, NO_SESSION);
		expect(stranger?.reviews[0]?.state).toBe("approved");
		expect(stranger?.reviews[0]?.decidedBy).toBeNull();
	});
});

describe("loadRunView, a comment run on the change request", () => {
	let openedRunId: string;
	let commentRunId: string;
	let pushRunId: string;

	beforeAll(async () => {
		await pool.query(
			`INSERT INTO events (id, delivery_id, raw_kind, raw, kind, actor_login, subject_number, head_sha, normalized)
			 VALUES ('evt-cmt-1', 'cmt-1', 'pull_request', '{}', 'change-request.opened', 'contrib', 9, 'ccc1111', '{}'),
			        ('evt-cmt-2', 'cmt-2', 'issue_comment', '{}', 'comment.created', 'contrib', 9, NULL, '{}'),
			        ('evt-cmt-3', 'cmt-3', 'pull_request', '{}', 'change-request.updated', 'contrib', 9, 'ddd2222', '{}')`,
		);
		const create = async (
			eventId: string,
			headSha: string | null,
			verdict: "pass" | "block",
			minutes: number,
		) => {
			const id = await runServices.createRun(db, {
				eventId,
				repoFullName: "acme/pub",
				subjectNumber: 9,
				headSha,
				snapshot: [DEFAULT_WORKFLOW],
				status: "completed",
				verdict,
			});
			await pool.query(
				`UPDATE runs SET created_at = created_at + make_interval(mins => $2) WHERE id = $1`,
				[id, minutes],
			);
			return id;
		};
		openedRunId = await create("evt-cmt-1", "ccc1111", "block", 0);
		commentRunId = await create("evt-cmt-2", null, "pass", 1);
		pushRunId = await create("evt-cmt-3", "ddd2222", "block", 2);
	});

	test("the push run replaces the opened run, not the comment run", async () => {
		const view = await loadRunView(db, pushRunId, SESSION);
		expect(view?.previousRun?.id).toBe(openedRunId);
		const opened = await loadRunView(db, openedRunId, SESSION);
		expect(opened?.nextRun?.id).toBe(pushRunId);
	});

	test("the comment run is neither replaced nor replacing", async () => {
		const view = await loadRunView(db, commentRunId, SESSION);
		expect(view?.previousRun).toBeNull();
		expect(view?.nextRun).toBeNull();
	});
});
