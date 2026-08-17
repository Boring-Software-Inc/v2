/**
 * GitLab end-to-end harness — the full contribution path, not just the pieces.
 *
 *   webhook POST → verify → tx(insert + enqueue) → worker processEvent →
 *   normalize → REAL GitLab reads → rules → verdict → actions
 *
 * Three phases, each gated on the one before, so a failure names the seam that
 * broke rather than "gitlab is broken":
 *
 *   1  inbound   POST a signed MR payload at the running api. Proves the route,
 *                HMAC verify, the insert+enqueue transaction, and redelivery
 *                idempotency (same delivery id twice ⇒ one row).
 *   2  pipeline  Run `processEvent` in-process with REAL GitLab reads and a NULL
 *                adapter — the built-in degraded mode, so actions are recorded
 *                but never executed. Nothing is written to any forge.
 *   3  writeback OPT-IN (`--execute`). Same as 2 with a live adapter, so the
 *                comment/check actually lands on the merge request.
 *
 * Phase 3 writes to a real project. It is off by default and requires
 * `--mr <project>!<iid>` naming a merge request you are happy to have commented
 * on. There is no default target on purpose.
 *
 *   bun --env-file=.env scripts/qa-gitlab-e2e.ts
 *   bun --env-file=.env scripts/qa-gitlab-e2e.ts --mr vys69/tripwire!1 --execute
 *
 * Not part of CI: needs live credentials, a database, and a running api.
 */
import { accountServices, createDb, eventServices } from "@tripwire/db";
import {
	createGitlabAdapter,
	GitlabReads,
	refreshGitlabToken,
	signWebhookBody,
} from "@tripwire/forge-gitlab";

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
	const i = args.indexOf(name);
	return i >= 0 ? (args[i + 1] ?? null) : null;
};
const EXECUTE = args.includes("--execute");
const MR_ARG = flag("--mr");
const API = process.env.QA_API_URL ?? "http://localhost:8787";

let failures = 0;
function check(area: string, ok: boolean, detail: string): void {
	if (!ok) {
		failures += 1;
	}
	process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${area} — ${detail}\n`);
}

const { db, pool } = createDb(
	process.env.DATABASE_URL ??
		"postgres://tripwire:tripwire@localhost:5432/tripwire",
);

// ── credentials ──────────────────────────────────────────────────────────────
const creds =
	process.env.GITLAB_OAUTH_CLIENT_ID && process.env.GITLAB_OAUTH_CLIENT_SECRET
		? {
				clientId: process.env.GITLAB_OAUTH_CLIENT_ID,
				clientSecret: process.env.GITLAB_OAUTH_CLIENT_SECRET,
				...(process.env.GITLAB_OAUTH_ISSUER
					? { baseUrl: process.env.GITLAB_OAUTH_ISSUER }
					: {}),
			}
		: null;

const { sql } = await import("drizzle-orm");
const accountRow = (
	await db.execute(
		sql`SELECT account_id AS "accountId" FROM account WHERE provider_id='gitlab' LIMIT 1`,
	)
).rows[0] as { accountId: string } | undefined;

if (!accountRow) {
	check("setup", false, "no linked gitlab account — connect gitlab first");
	await pool.end();
	process.exit(1);
}

const token = await accountServices.getFreshForgeToken(
	db,
	"gitlab",
	accountRow.accountId,
	async (rt) => {
		if (!creds) {
			throw new Error("GITLAB_OAUTH_CLIENT_ID/SECRET absent");
		}
		return await refreshGitlabToken(creds, rt);
	},
);
check("setup/token", true, `usable gitlab token for ${accountRow.accountId}`);

// ── target merge request ─────────────────────────────────────────────────────
/** Ask GitLab for a real MR so the payload describes something that exists —
 * a synthetic iid makes every read 404 and every rule "skip", which looks like
 * a passing pipeline while testing nothing. */
async function resolveTarget(): Promise<{
	project: string;
	iid: number;
	projectId: number;
	projectName: string;
	author: string;
	sha: string;
	title: string;
} | null> {
	const candidates: { project: string; iid?: number }[] = [];
	if (MR_ARG) {
		const [project, iid] = MR_ARG.split("!");
		if (!(project && iid)) {
			throw new Error("--mr expects <group/project>!<iid>");
		}
		candidates.push({ project, iid: Number(iid) });
	} else {
		const rows = await db.execute(
			sql`SELECT full_name AS "fullName" FROM repos WHERE forge='gitlab' AND removed_at IS NULL`,
		);
		for (const row of rows.rows as { fullName: string }[]) {
			candidates.push({ project: row.fullName });
		}
	}
	for (const candidate of candidates) {
		const base = `https://gitlab.com/api/v4/projects/${encodeURIComponent(candidate.project)}`;
		const url =
			candidate.iid === undefined
				? `${base}/merge_requests?per_page=1&state=all`
				: `${base}/merge_requests/${candidate.iid}`;
		const res = await fetch(url, {
			headers: { authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			continue;
		}
		const body = (await res.json()) as
			| Record<string, unknown>
			| Record<string, unknown>[];
		const mr = (Array.isArray(body) ? body[0] : body) as
			| Record<string, unknown>
			| undefined;
		if (!mr) {
			continue;
		}
		const projectRes = await fetch(base, {
			headers: { authorization: `Bearer ${token}` },
		});
		const project = (await projectRes.json()) as { id: number; name: string };
		return {
			project: candidate.project,
			iid: mr.iid as number,
			projectId: project.id,
			projectName: project.name,
			author: (mr.author as { username: string }).username,
			sha: (mr.sha as string) ?? "0".repeat(40),
			title: mr.title as string,
		};
	}
	return null;
}

const target = await resolveTarget();
if (!target) {
	check(
		"setup/merge-request",
		false,
		"no reachable merge request on any imported gitlab project — pass --mr <project>!<iid>",
	);
	await pool.end();
	process.exit(1);
}
check(
	"setup/merge-request",
	true,
	`${target.project}!${target.iid} "${target.title}" by @${target.author}`,
);

// §4 arming gate: an UNARMED repo is skipped entirely — no run, no rules, no
// check. Testing against one looks like a clean pass while nothing was
// evaluated, so the harness makes the repo's state explicit and, for a project
// tripwire does not watch, registers a temporary armed row it removes at the end.
const repoRow = (
	await db.execute(
		sql`SELECT id, armed FROM repos WHERE forge='gitlab' AND full_name=${target.project} AND removed_at IS NULL`,
	)
).rows[0] as { id: string; armed: boolean } | undefined;

let tempRepoId: string | null = null;
let restoreArmed = false;
if (!repoRow) {
	const { repoServices } = await import("@tripwire/db");
	tempRepoId = await repoServices.ensureRepo(db, {
		forge: "gitlab",
		externalId: String(target.projectId),
		owner: target.project.split("/")[0] ?? target.project,
		name: target.project.split("/").pop() ?? target.project,
		fullName: target.project,
		private: false,
		installationId: accountRow.accountId,
		orgId: null,
	});
	await db.execute(sql`UPDATE repos SET armed = true WHERE id = ${tempRepoId}`);
	check(
		"setup/repo",
		true,
		`${target.project} not watched — registered a TEMPORARY armed repo (removed at exit)`,
	);
} else if (!repoRow.armed) {
	await db.execute(sql`UPDATE repos SET armed = true WHERE id = ${repoRow.id}`);
	restoreArmed = true;
	check(
		"setup/repo",
		true,
		`${target.project} was NOT ARMED — armed for this run, restored at exit`,
	);
} else {
	check("setup/repo", true, `${target.project} is watched and armed`);
}

async function cleanup(): Promise<void> {
	if (tempRepoId) {
		await db.execute(sql`DELETE FROM repos WHERE id = ${tempRepoId}`);
	}
	if (restoreArmed && repoRow) {
		await db.execute(
			sql`UPDATE repos SET armed = false WHERE id = ${repoRow.id}`,
		);
	}
}

// ── phase 1: inbound ─────────────────────────────────────────────────────────
/** Shaped like GitLab's Merge Request Hook. Field set matches what the adapter
 * parses; values come from the live MR above so the reads that follow resolve. */
const payload = {
	object_kind: "merge_request",
	event_type: "merge_request",
	user: { id: 1, username: target.author, avatar_url: null },
	project: {
		id: target.projectId,
		name: target.projectName,
		path_with_namespace: target.project,
	},
	object_attributes: {
		iid: target.iid,
		title: target.title,
		source_branch: "qa-e2e",
		target_branch: "main",
		url: `https://gitlab.com/${target.project}/-/merge_requests/${target.iid}`,
		action: "open",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		last_commit: { id: target.sha },
	},
};
const body = JSON.stringify(payload);
const secret = process.env.GITLAB_WEBHOOK_SECRET ?? "";
// Timestamped so reruns are distinct deliveries, not redeliveries of the first.
const deliveryId = `qa-e2e-${target.iid}-${process.env.QA_RUN_ID ?? Bun.hash(body).toString(36)}`;

async function deliver(id: string): Promise<Response> {
	return await fetch(`${API}/webhooks/gitlab`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-gitlab-webhook-uuid": id,
			"x-gitlab-event": "Merge Request Hook",
			"webhook-signature": signWebhookBody(body, secret),
		},
		body,
	});
}

const bad = await fetch(`${API}/webhooks/gitlab`, {
	method: "POST",
	headers: {
		"content-type": "application/json",
		"x-gitlab-webhook-uuid": `${deliveryId}-bad`,
		"x-gitlab-event": "Merge Request Hook",
		"webhook-signature": signWebhookBody(body, "wrong-secret"),
	},
	body,
}).catch(() => null);
check(
	"inbound/reject-bad-signature",
	bad?.status === 401,
	`expected 401, got ${bad?.status ?? "no response — is the api running?"}`,
);

const first = await deliver(deliveryId);
const firstBody = (await first.json().catch(() => ({}))) as {
	duplicate?: boolean;
};
check(
	"inbound/accept",
	first.status === 200 && firstBody.duplicate === false,
	`status ${first.status}, duplicate=${firstBody.duplicate}`,
);

const second = await deliver(deliveryId);
const secondBody = (await second.json().catch(() => ({}))) as {
	duplicate?: boolean;
};
// §5: UNIQUE(delivery_id) is the idempotency guarantee — a redelivery must be a
// no-op, not a second run on the same merge request.
check(
	"inbound/redelivery-is-noop",
	second.status === 200 && secondBody.duplicate === true,
	`status ${second.status}, duplicate=${secondBody.duplicate}`,
);

const eventRows = await db.execute(
	sql`SELECT id, forge, normalized_at IS NOT NULL AS normalized, quarantined
	    FROM events WHERE delivery_id = ${deliveryId}`,
);
check(
	"inbound/one-row",
	eventRows.rows.length === 1,
	`${eventRows.rows.length} event row(s) for the delivery id`,
);
const eventId = (eventRows.rows[0] as { id: string } | undefined)?.id;

// ── phase 2: pipeline ────────────────────────────────────────────────────────
if (eventId) {
	const { processEvent } = await import(
		"../apps/worker/src/jobs/process-event.ts"
	);
	// A stub rather than pino: `scripts/` is not a workspace package so pino does
	// not resolve here, and processEvent only ever calls these four.
	const noop = () => undefined;
	const logger = {
		info: noop,
		warn: (obj: unknown, msg?: string) =>
			process.stdout.write(`      warn: ${msg ?? ""} ${JSON.stringify(obj)}
`),
		error: (obj: unknown, msg?: string) =>
			process.stdout.write(`      error: ${msg ?? ""} ${JSON.stringify(obj)}
`),
		debug: noop,
		child: () => logger,
	};

	const reads = new GitlabReads({ tokenFor: async () => token });
	// adapter null ⇒ §4 degraded mode: actions are recorded but not executed, so
	// phase 2 never touches the merge request. `--execute` swaps in a live one.
	const adapter = EXECUTE
		? createGitlabAdapter({ tokenFor: async () => token })
		: null;

	try {
		await processEvent(
			{
				db,
				pool: pool as never,
				logger: logger as never,
				resolveForge: (forge) =>
					forge === "gitlab"
						? { adapter, reads: reads as never, signalHttp: null }
						: null,
				makeGenerate: null,
				appUrl: process.env.APP_URL ?? "http://localhost:3000",
			} as never,
			{ eventId },
		);
		check("pipeline/process-event", true, "processed without throwing");
	} catch (error) {
		check(
			"pipeline/process-event",
			false,
			error instanceof Error ? error.message : String(error),
		);
	}

	const after = (
		await db.execute(
			sql`SELECT normalized_at IS NOT NULL AS normalized, quarantined
			    FROM events WHERE id = ${eventId}`,
		)
	).rows[0] as { normalized: boolean; quarantined: boolean } | undefined;
	check(
		"pipeline/normalized",
		Boolean(after?.normalized) && !after?.quarantined,
		`normalized=${after?.normalized} quarantined=${after?.quarantined}`,
	);

	const runs = await db.execute(
		sql`SELECT id, verdict, status FROM runs WHERE event_id = ${eventId}`,
	);
	const run = runs.rows[0] as
		| { id: string; verdict: string; status: string }
		| undefined;
	check(
		"pipeline/run-persisted",
		Boolean(run),
		run ? `verdict=${run.verdict} status=${run.status}` : "no run row",
	);

	if (run) {
		const steps = await db.execute(
			sql`SELECT rule_id AS "ruleRef", status FROM run_steps WHERE run_id = ${run.id} ORDER BY started_at`,
		);
		const rows = steps.rows as { ruleRef: string | null; status: string }[];
		const evaluated = rows.filter(
			(r) => r.status === "pass" || r.status === "fail",
		);
		// Every rule skipping means the reads came back empty — the pipeline "ran"
		// while gating nothing, which is the failure this phase exists to catch.
		check(
			"rules/evaluated",
			evaluated.length > 0,
			`${evaluated.length}/${rows.length} steps evaluated: ${rows
				.map((r) => `${r.ruleRef ?? "node"}=${r.status}`)
				.join(" ")}`,
		);

		const actions = await db.execute(
			sql`SELECT kind, executed_at IS NOT NULL AS executed FROM run_actions WHERE run_id = ${run.id}`,
		);
		const actionRows = actions.rows as { kind: string; executed: boolean }[];
		check(
			"actions/recorded",
			true,
			actionRows.length === 0
				? "none planned"
				: actionRows
						.map((a) => `${a.kind}${a.executed ? " (executed)" : ""}`)
						.join(", "),
		);
		if (!EXECUTE) {
			// §5.12 records actions before executing; without an adapter none may
			// have run, or phase 2 silently wrote to a real merge request.
			check(
				"actions/dry-run-honoured",
				actionRows.every((a) => !a.executed),
				actionRows.some((a) => a.executed)
					? "an action EXECUTED without --execute"
					: "nothing executed, as expected",
			);
		}
	}
}

await cleanup();
await pool.end();
process.stdout.write(
	failures === 0
		? `\nall checks passed${EXECUTE ? "" : " (dry run — pass --mr <project>!<iid> --execute to post for real)"}\n`
		: `\n${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
