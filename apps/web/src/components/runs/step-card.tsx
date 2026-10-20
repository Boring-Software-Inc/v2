import { RULE_CATALOG, ruleDisplayName, ruleIdOf } from "@tripwire/contracts";
import { Status, type StatusValue } from "#/components/glaze/ui/status";
import { RuleEvidence } from "#/components/runs/rule-evidence";
import type { RunStepView } from "#/lib/runs.functions";
import { describeSyntheticStep } from "#/lib/synthetic-steps";

const STEP_STATUS: Record<string, { status: StatusValue; label: string }> = {
	pass: { status: "ok", label: "Passed" },
	fail: { status: "fail", label: "Did not pass" },
	skipped: { status: "idle", label: "Skipped" },
	paused: { status: "waiting", label: "Sent to review" },
	pending: { status: "queued", label: "Queued" },
};

function sentence(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function ruleFallback(ruleRef: string): string {
	const cat = RULE_CATALOG.find((r) => r.ruleId === ruleIdOf(ruleRef));
	return cat?.blurb ?? ruleDisplayName(ruleRef);
}

function stepLabel(step: RunStepView): string {
	if (step.ruleRef) {
		return step.ruleName ?? ruleDisplayName(step.ruleRef);
	}
	return sentence(step.label ?? step.nodeKind);
}

function StepStatus({ status }: { status: string }) {
	const s = STEP_STATUS[status];
	if (!s) {
		return null;
	}
	return (
		<Status className="shrink-0" size="sm" status={s.status}>
			{s.label}
		</Status>
	);
}

export function StepCard({
	step,
	repo,
	sha,
	maintainer,
}: {
	step: RunStepView;
	isFirst?: boolean;
	isLast?: boolean;
	repo: string;
	sha: string | null;
	maintainer: boolean;
}) {
	const synthetic = describeSyntheticStep(step);

	if (synthetic) {
		return (
			<div className="rule-row min-h-(--row) px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="min-w-0 flex-1 truncate type-label">
						{sentence(synthetic.title)}
					</span>
					<span className="hidden shrink-0 type-code-sm text-text-2 sm:inline">
						{step.nodeId}
					</span>
					<Status
						className="shrink-0"
						size="sm"
						status={synthetic.kind === "deny-floor" ? "fail" : "warn"}
					>
						{synthetic.kind === "deny-floor" ? "Blocked" : "Incomplete"}
					</Status>
				</div>
				<p className="mt-1 type-body-sm text-text-2">
					{sentence(synthetic.detail)}
				</p>
			</div>
		);
	}

	const label = stepLabel(step);
	const line =
		step.summary ?? (step.ruleRef ? ruleFallback(step.ruleRef) : null);
	const failed = step.status === "fail";

	return (
		<div className="rule-row min-h-(--row) px-3 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<span className="shrink-0 truncate type-label">{label}</span>
				<span className="min-w-0 flex-1 truncate type-body-sm text-text-2">
					{failed || !line ? "" : sentence(line)}
				</span>
				{maintainer && step.ruleRef ? (
					<span className="hidden shrink-0 type-code-sm text-text-2 sm:inline">
						{step.ruleRef}
					</span>
				) : null}
				<StepStatus status={step.status} />
				<span className="min-w-12 shrink-0 text-end type-caption text-text-2 tabular-nums">
					{step.durationMs}ms
				</span>
			</div>
			{failed ? (
				<>
					{line ? (
						<p className="mt-2 type-body text-text-1">{sentence(line)}</p>
					) : null}
					{step.nodeKind === "rule" ? (
						<RuleEvidence
							maintainer={maintainer}
							repo={repo}
							sha={sha}
							step={step}
						/>
					) : null}
				</>
			) : null}
		</div>
	);
}
