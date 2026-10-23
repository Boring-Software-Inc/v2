import { createServerFn } from "@tanstack/react-start";
import type {
	EventKind,
	ForgeId,
	ThreadSubject,
	Verdict,
} from "@tripwire/contracts";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { orgPermissionMiddleware } from "#/lib/server/org-guard";

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

export interface RunEventView {
	kind: EventKind | null;
	actor: string | null;
	title: string | null;
	headSha: string | null;
	at: string;
}

export type WorkflowOutcome = "block" | "review" | "pass" | "unrunnable";

export interface RunWorkflowView {
	id: string;
	name: string;
	outcome: WorkflowOutcome | null;
}

export interface RunReviewView {
	workflowId: string | null;
	state: "open" | "approved" | "denied" | "closed";
	degraded: boolean;
	openedAt: string;
	decidedAt: string | null;
	decidedBy: string | null;
}

export interface RunLinkView {
	id: string;
	createdAt: string;
	status: string;
	verdict: Verdict | null;
	eventKind: EventKind | null;
	actor: string | null;
	headSha: string | null;
	rerun: boolean;
}

export interface RunActionView {
	kind: string;
	status: string;
	recordedAt: string;
	url: string | null;
	label?: string | null;
	delivery?:
		| { state: "sent" }
		| { state: "queued" }
		| { state: "failed"; reason: string };
}

export interface RunView {
	id: string;
	repoFullName: string;
	subjectNumber: number | null;
	subjectKind: ThreadSubject;
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
	/** The forge this run's repo lives on; null when the repo row is gone. */
	forge: ForgeId | null;
	/**
	 * The change request on its forge. Null when the run has no change request,
	 * or when the repo row is gone. Kept on the public view: that view only
	 * renders for a repo that is not private, so the link reveals nothing the
	 * viewer could not already open.
	 */
	subjectUrl: string | null;
	/** Whether THIS viewer may re-run: admin, full view, and a CR to target. */
	canRerun: boolean;
	stepsHidden: boolean;
	steps: RunStepView[];
	actions: RunActionView[];
	redactionLevel: number;
	event: RunEventView | null;
	workflows: RunWorkflowView[];
	reviews: RunReviewView[];
	previousRun: RunLinkView | null;
	nextRun: RunLinkView | null;
	backfill: boolean;
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
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("activity:read")])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<string | null> => {
		const { resolveOrgRepo } = await import("#/lib/server/org-guard");
		const org = (context as { org: { id: string } }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { runServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await runServices.latestRunIdForRepo(getDb().db, repo.fullName);
	});
