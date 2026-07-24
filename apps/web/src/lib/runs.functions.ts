import { createServerFn } from "@tanstack/react-start";
import type { Verdict } from "@tripwire/contracts";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { orgMemberMiddleware } from "#/lib/server/org-guard";

/** Serializable JSON — evidence/output cross the server-fn boundary as JSON. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface RunStepView {
	id: string;
	nodeId: string;
	nodeKind: string;
	ruleRef: string | null;
	/** Snapshot-resolved display label for non-rule nodes (action kind, gate
	 * mode, "trigger") so editor-created UUID nodes don't render as bare ids. */
	label?: string;
	/** Resolved rule display name — built-ins via the catalog, custom rules via
	 * the repo's stored name — so custom refs never render as the bare generated
	 * ref. Null for non-rule steps. Resolved server-side (one place, no drift). */
	ruleName?: string | null;
	status: string;
	evidence: JsonValue;
	output: JsonValue;
	durationMs: number;
	startedAt: string;
	/**
	 * §10 stored public partition — raw material for the public swap; STRIPPED
	 * from the session view (which shows full `evidence`).
	 */
	publicEvidence?: JsonValue;
	/** §10 public view only — the rule's plain-English outcome. */
	summary?: string | null;
}

export interface RunView {
	id: string;
	repoFullName: string;
	subjectNumber: number | null;
	headSha: string | null;
	status: string;
	verdict: Verdict | null;
	createdAt: string;
	completedAt: string | null;
	/** Workflow definitions as stored (JSON); null on the public view (§10). */
	snapshot: JsonValue;
	/** §10 — "public" renders the no-session view (footer, no trace). */
	access: "full" | "public";
	/** Manual re-run by an admin. The FACT is public; the actor is not. */
	rerun: boolean;
	/** The triggering admin's display name — full view only (§10). */
	rerunBy: string | null;
	/**
	 * §6 re-run scope — the org slug + repo name the admin-gated re-run mutation
	 * is addressed by. The run route carries only a runId, so the full view
	 * surfaces the scope; the public view carries none of it (both null).
	 */
	orgSlug: string | null;
	repoName: string | null;
	/** Whether THIS viewer may re-run: admin, full view, and a CR to target. */
	canRerun: boolean;
	steps: RunStepView[];
	actions: {
		kind: string;
		status: string;
		recordedAt: string;
		/** Outbound (webhook/discord) delivery state, derived without the url —
		 * `recorded` alone must never read as delivered. */
		delivery?:
			| { state: "sent" }
			| { state: "queued" }
			| { state: "failed"; reason: string };
	}[];
}

/**
 * §10 — this is the ONE server function readable without a session: the run
 * page is unlisted-public so blocked contributors can read the judgment.
 * Access shaping (public view, private-repo denial) lives in loadRunView.
 */
export const getRun = createServerFn({ method: "GET" })
	.inputValidator((input: { runId: string }) => input)
	.handler(async ({ data }): Promise<RunView | null> => {
		const { loadRunView } = await import("#/lib/server/run-view");
		const { readSessionState } = await import("#/lib/server/session");
		const { getDb } = await import("#/lib/server/db");
		return await loadRunView(getDb().db, data.runId, await readSessionState());
	});

/**
 * §4 — the latest run id for the ACTIVE repo, powering the command palette's
 * "latest run" jump. Null when the repo has no runs yet (nothing to jump to).
 */
export const getLatestRunId = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<string | null> => {
		const { resolveOrgRepo } = await import("#/lib/server/org-guard");
		const org = (context as { org: { id: string } }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { runServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await runServices.latestRunIdForRepo(getDb().db, repo.fullName);
	});
