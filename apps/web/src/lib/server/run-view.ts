import type { Verdict, WorkflowDefinition } from "@tripwire/contracts";
import { type Db, orgServices, repoServices, runServices } from "@tripwire/db";
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
	// The repo row backs both the no-session privacy gate and the full view's
	// re-run scope (org slug + repo name + the admin check).
	const repo = await repoServices.getRepoByFullName(
		db,
		result.run.repoFullName,
	);
	const repoPrivate =
		session.authEnabled && !hasSession ? (repo?.private ?? null) : null;
	const access = resolveRunAccess({
		authEnabled: session.authEnabled,
		hasSession,
		repoPrivate,
	});
	if (access === "denied") {
		return null;
	}

	// §6 — re-run is admin-only and addressed by org slug + repo name. Resolve
	// the scope for the full view only; the public view carries none of it and
	// `canRerun` stays false. Open-dev (auth disabled) treats the viewer as admin.
	let orgSlug: string | null = null;
	let repoName: string | null = null;
	let canRerun = false;
	if (access === "full" && repo?.orgId) {
		orgSlug = await orgSlugById(db, repo.orgId);
		repoName = repo.name;
		const admin = !session.authEnabled
			? true
			: session.userId
				? (await orgServices.getMemberRole(db, {
						orgId: repo.orgId,
						userId: session.userId,
					})) === "admin"
				: false;
		canRerun = admin && result.run.subjectNumber !== null;
	}
	const nodeLabels = snapshotNodeLabels(result.run.workflowSnapshot);
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
		orgSlug,
		repoName,
		canRerun,
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
			// Resolve a display label from the snapshot so editor-created nodes
			// (UUID ids) don't render as bare ids. Carries no secret.
			label: resolveStepLabel(step.nodeId, nodeLabels),
		})),
		actions: result.actions.map((action) => ({
			kind: action.kind,
			status: action.status,
			recordedAt: action.recordedAt.toISOString(),
			delivery: deliveryStatus(action),
		})),
	};
	return access === "public" ? toPublicRunView(view) : toFullRunView(view);
}

/** Synthetic step ids the executor emits that aren't snapshot nodes — the
 * resume floor records a block under this id when the graph drew none. */
const SYNTHETIC_STEP_LABELS: Record<string, string> = {
	"run:deny-floor": "block",
};

/**
 * The display label for a step. Resumed steps carry a trailing `:resume`
 * (resume-run.ts re-keys them so their ids stay unique), which the snapshot map
 * does not — strip it before lookup, then fall back to the synthetic table.
 * Without this, the resumed moderation node and its downstream actions render as
 * bare `action`.
 */
function resolveStepLabel(
	nodeId: string,
	labels: Map<string, string>,
): string | undefined {
	return (
		labels.get(nodeId) ??
		labels.get(nodeId.replace(/:resume$/, "")) ??
		SYNTHETIC_STEP_LABELS[nodeId]
	);
}

/**
 * Map each `{workflowId}:{nodeId}` step key to a readable label from the run's
 * snapshot: an action shows its kind (block/webhook/discord/label), a gate its
 * mode, a trigger "trigger". Rules resolve from `ruleRef` in the component.
 * Labels carry no secret, so this runs before the public/full split.
 */
function snapshotNodeLabels(snapshot: unknown): Map<string, string> {
	const labels = new Map<string, string>();
	if (!Array.isArray(snapshot)) {
		return labels;
	}
	for (const def of snapshot as WorkflowDefinition[]) {
		for (const node of def.nodes ?? []) {
			const key = `${def.id}:${node.id}`;
			if (node.type === "action") {
				labels.set(key, node.action);
			} else if (node.type === "gate") {
				labels.set(key, node.mode);
			} else if (node.type === "trigger") {
				labels.set(key, "trigger");
			}
		}
	}
	return labels;
}

/**
 * The honest delivery state for an outbound (webhook/discord) action, derived
 * from the row WITHOUT the url. `recorded` alone must never read as delivered:
 * a failed delivery carries `deliveryFailure`, a queued one does not, a sent
 * one is `executed`. This is the alerting-integrity fix — a maintainer must see
 * whether the alert actually went out.
 */
export type DeliveryState =
	| { state: "sent" }
	| { state: "queued" }
	| { state: "failed"; reason: string };

function deliveryStatus(action: {
	kind: string;
	status: string;
	payload: unknown;
}): DeliveryState | undefined {
	if (action.kind !== "webhook" && action.kind !== "discord") {
		return undefined;
	}
	if (action.status === "executed") {
		return { state: "sent" };
	}
	const payload =
		action.payload && typeof action.payload === "object"
			? (action.payload as Record<string, unknown>)
			: {};
	const failure =
		typeof payload.deliveryFailure === "string"
			? payload.deliveryFailure
			: undefined;
	// Recorded + a logged failure ⇒ it was attempted and failed (still
	// retrying, or abandoned if superseded). Recorded + no failure ⇒ not yet
	// attempted.
	if (failure) {
		return { state: "failed", reason: failure };
	}
	return { state: "queued" };
}

/** The owning org's URL slug — feeds the run view's re-run scope (the mutation
 * is addressed by slug, §6). */
async function orgSlugById(db: Db, orgId: string): Promise<string | null> {
	const { schema } = await import("@tripwire/db");
	const { eq } = await import("drizzle-orm");
	const rows = await db
		.select({ slug: schema.organization.slug })
		.from(schema.organization)
		.where(eq(schema.organization.id, orgId))
		.limit(1);
	return rows[0]?.slug ?? null;
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
