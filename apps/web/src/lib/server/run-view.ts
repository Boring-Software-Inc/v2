import type { Verdict } from "@tripwire/contracts";
import { type Db, repoServices, runServices } from "@tripwire/db";
import {
	resolveRunAccess,
	toFullRunView,
	toPublicRunView,
} from "#/lib/run-access";
import type { JsonValue, RunView } from "#/lib/runs.functions";
import type { SessionState } from "#/lib/server/session";

/**
 * §10 — loads a run and applies the access model: sessions (and open-dev)
 * get the full view; no session gets the public view of a PUBLIC-repo run
 * (trace stripped) and nothing at all for private or unknown repos — a
 * denied run is indistinguishable from a missing one.
 */
export async function loadRunView(
	db: Db,
	runId: string,
	session: SessionState,
): Promise<RunView | null> {
	const result = await runServices.getRunWithSteps(db, runId);
	if (!result) {
		return null;
	}
	const hasSession = session.userId !== null;
	let repoPrivate: boolean | null = null;
	if (session.authEnabled && !hasSession) {
		const repo = await repoServices.getRepoByFullName(
			db,
			result.run.repoFullName,
		);
		repoPrivate = repo?.private ?? null;
	}
	const access = resolveRunAccess({
		authEnabled: session.authEnabled,
		hasSession,
		repoPrivate,
	});
	if (access === "denied") {
		return null;
	}
	const view: RunView = {
		id: result.run.id,
		repoFullName: result.run.repoFullName,
		subjectNumber: result.run.subjectNumber,
		headSha: result.run.headSha,
		status: result.run.status,
		verdict: result.run.verdict as Verdict | null,
		createdAt: result.run.createdAt.toISOString(),
		completedAt: result.run.completedAt?.toISOString() ?? null,
		snapshot: result.run.workflowSnapshot as JsonValue,
		access: "full",
		rerun: result.run.triggeredBy !== null,
		rerunBy:
			result.run.triggeredBy && access === "full"
				? await resolveTriggeredByName(db, result.run.triggeredBy)
				: null,
		steps: result.steps.map((step) => ({
			id: step.id,
			nodeId: step.nodeId,
			nodeKind: step.nodeKind,
			ruleRef: step.ruleId,
			status: step.status,
			evidence: step.evidence as JsonValue,
			output: step.output as JsonValue,
			durationMs: step.durationMs,
			startedAt: step.startedAt.toISOString(),
			publicEvidence: step.publicEvidence as JsonValue,
			summary: step.summary,
		})),
		actions: result.actions.map((action) => ({
			kind: action.kind,
			status: action.status,
			recordedAt: action.recordedAt.toISOString(),
		})),
	};
	return access === "public" ? toPublicRunView(view) : toFullRunView(view);
}

/** The re-run admin's display name; falls back to the raw id ("dev", "cli:…"). */
async function resolveTriggeredByName(db: Db, userId: string): Promise<string> {
	const { schema } = await import("@tripwire/db");
	const { eq } = await import("drizzle-orm");
	const rows = await db
		.select({ name: schema.user.name })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.limit(1);
	return rows[0]?.name ?? userId;
}
