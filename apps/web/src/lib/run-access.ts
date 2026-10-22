import {
	redactEvidence,
	redactionHides,
	redactSummary,
} from "@tripwire/contracts";
import type { JsonValue, RunStepView, RunView } from "#/lib/runs.functions";

/**
 * §10 access model — viewing is public, deciding is gated. `/runs/{id}` is
 * unlisted-public (gist-style, unguessable UUIDv7) so a blocked contributor
 * can read the judgment; everything mutating or list-shaped stays behind a
 * session. Pure decisions live here so the policy is unit-testable.
 */

export type RunAccess = "full" | "public" | "denied";

export interface RunAccessInput {
	/** false in open-dev posture (resolveAuthPosture) — the gate stands open. */
	authEnabled: boolean;
	isOrgMember: boolean;
	/**
	 * Repo visibility from installation sync; null when the repo row is
	 * missing or unresolved — treated as private (fail closed).
	 */
	repoPrivate: boolean | null;
}

export function resolveRunAccess({
	authEnabled,
	isOrgMember,
	repoPrivate,
}: RunAccessInput): RunAccess {
	if (!authEnabled || isOrgMember) {
		return "full";
	}
	return repoPrivate === false ? "public" : "denied";
}

const PUBLIC_RUN_PATH = /^\/runs\/[^/]+\/?$/;

/**
 * Routes reachable without a session: /login and the single run page. Run
 * LISTS and every other index route stay behind the root redirect — a
 * crawlable index of verdicts must not exist (§10).
 */
export function isPublicPath(pathname: string): boolean {
	return (
		pathname === "/login" ||
		PUBLIC_RUN_PATH.test(pathname) ||
		(import.meta.env.DEV === true &&
			(pathname === "/mascot" || pathname === "/game"))
	);
}

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Public render of a rule step (§10). The projection is already stored (the
 * worker ran the rule's own `publicEvidence`/`summarize` at persist time), so
 * this is a DUMB swap — web holds ZERO rule knowledge: replace the inner
 * evidence with the stored public partition (thresholds + trace gone) and
 * attach the stored one-liner. Pre-§10 runs have no partition (null) ⇒ the
 * step keeps its pass/fail but shows no evidence detail. Non-rule steps carry
 * no thresholds and pass through (projection fields dropped).
 */
function toPublicStep(step: RunStepView, level: number): RunStepView {
	const { publicEvidence, ...rest } = step;
	if (!step.ruleRef) {
		const { summary: _summary, ...bare } = rest;
		return bare;
	}
	const envelope = step.evidence;
	const publicInner = redactEvidence(
		step.ruleRef,
		publicEvidence ?? null,
		level,
	);
	const sanitized: JsonValue = isJsonRecord(envelope)
		? { ...envelope, evidence: publicInner }
		: publicInner;
	const summary = redactSummary(step.ruleRef, step.summary ?? null, level);
	if (redactionHides(level, "rule-names")) {
		return {
			...rest,
			ruleRef: null,
			ruleName: null,
			label: "rule",
			evidence: null,
			output: null,
			summary: null,
		};
	}
	return { ...rest, evidence: sanitized, output: sanitized, summary };
}

function visibleToPublic(step: RunStepView, level: number): boolean {
	if (step.nodeKind !== "rule") {
		return !redactionHides(level, "rule-names");
	}
	if (redactionHides(level, "failed-count")) {
		return false;
	}
	return !redactionHides(level, "passed-count") || step.status === "fail";
}

/**
 * Public render of a run: verdict, per-rule steps, the contributor-fact
 * evidence + ai-review findings + a plain-English outcome per rule — no
 * configured thresholds, no ai-review trace, no workflow snapshot (§10).
 */
export function toPublicRunView(view: RunView, level = 0): RunView {
	return {
		...view,
		access: "public",
		snapshot: null,
		// §10: the FACT of a manual re-run is public; the actor never is.
		rerunBy: null,
		// Deciding is gated — public viewers carry no re-run scope or permission.
		orgSlug: null,
		repoName: null,
		canRerun: false,
		stepsHidden: redactionHides(level, "failed-count"),
		steps: view.steps
			.filter((step) => visibleToPublic(step, level))
			.map((step) => toPublicStep(step, level)),
		actions: redactionHides(level, "rule-names") ? [] : view.actions,
	};
}

/**
 * Session render — full raw evidence, plus the rule's plain-English `summary`
 * (the run page shows it: quiet on a passed step, the statement on a failed
 * one). Drops only the `publicEvidence` carrier, which exists solely to feed
 * `toPublicRunView` and is never rendered.
 */
export function toFullRunView(view: RunView): RunView {
	return {
		...view,
		stepsHidden: false,
		steps: view.steps.map(({ publicEvidence: _pe, ...step }) => step),
	};
}
