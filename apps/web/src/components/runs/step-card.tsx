import { RULE_CATALOG, ruleDisplayName, ruleIdOf } from "@tripwire/contracts";
import { RuleEvidence } from "#/components/runs/rule-evidence";
import type { RunStepView } from "#/lib/runs.functions";
import { describeSyntheticStep } from "#/lib/synthetic-steps";
import { cn } from "#/lib/utils";

const STATUS_DOT: Record<string, string> = {
	pass: "bg-emerald-500",
	fail: "bg-red-500",
	skipped: "bg-muted-foreground/40",
	paused: "bg-amber-500",
	pending: "bg-muted-foreground/40 animate-pulse",
};

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
	pass: {
		label: "passed",
		className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	},
	fail: {
		label: "failed",
		className: "bg-red-500/10 text-red-600 dark:text-red-400",
	},
	skipped: {
		label: "skipped",
		className: "bg-surface-1 text-muted-foreground",
	},
	paused: {
		label: "review",
		className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	},
	pending: {
		label: "queued",
		className: "bg-surface-1 text-muted-foreground",
	},
};

/** A step with no stored summary (a pre-projection historical run) falls back to
 * what the rule CHECKS — its catalog blurb — never a blank statement, never raw
 * JSON, and never just echoing the rule id in the header. */
function ruleFallback(ruleRef: string): string {
	const cat = RULE_CATALOG.find((r) => r.ruleId === ruleIdOf(ruleRef));
	return cat?.blurb ?? ruleDisplayName(ruleRef);
}

/** The step's display label: the rule's human name (§6 display — the `@version`
 * tag is engine identity, shown only on the maintainer/operator detail below),
 * a non-rule node as its bare kind (never "trigger: trigger"). */
function stepLabel(step: RunStepView): string {
	if (step.ruleRef) {
		// Server-resolved through the merged catalog (custom names included);
		// fall back for pre-resolution cached views.
		return step.ruleName ?? ruleDisplayName(step.ruleRef);
	}
	// Snapshot-resolved label (action kind / gate mode / "trigger"); fall back
	// to the node kind, never the raw UUID id.
	return step.label ?? step.nodeKind;
}

/** The status badge — the only saturated element in a step; min-width keeps
 * every row's chip in one column regardless of label length. */
function StepStatus({ status }: { status: string }) {
	const chip = STATUS_CHIP[status];
	if (!chip) {
		return null;
	}
	return (
		<span
			className={cn(
				"min-w-16 shrink-0 rounded-full px-2 py-0.5 text-center font-medium text-xs",
				chip.className,
			)}
		>
			{chip.label}
		</span>
	);
}

/**
 * The left rail: the status dot with a vertical connector line threading every
 * step's dot into one timeline. The line is clipped at the first/last dot so it
 * never sticks out past the ends. The dot sits at ~22px (the title's centre).
 */
function StepRail({
	color,
	isFirst,
	isLast,
}: {
	color: string;
	isFirst: boolean;
	isLast: boolean;
}) {
	return (
		<div className="relative w-1.5 shrink-0">
			<span
				className={cn(
					"absolute left-1/2 w-px -translate-x-1/2 bg-border",
					isFirst ? "top-[22px]" : "top-0",
					isLast ? "bottom-[calc(100%-22px)]" : "bottom-0",
				)}
			/>
			<span
				className={cn(
					"absolute top-[19px] left-0 size-1.5 rounded-full",
					color,
				)}
			/>
		</div>
	);
}

export function StepCard({
	step,
	isFirst,
	isLast,
	repo,
	sha,
	maintainer,
}: {
	step: RunStepView;
	isFirst: boolean;
	isLast: boolean;
	repo: string;
	sha: string | null;
	/** Full (session/open-dev) view — the raw disclosure is hidden from public. */
	maintainer: boolean;
}) {
	const synthetic = describeSyntheticStep(step);
	const dotColor = synthetic
		? synthetic.kind === "deny-floor"
			? "bg-red-500"
			: "bg-amber-500"
		: (STATUS_DOT[step.status] ?? "bg-muted-foreground/40");

	if (synthetic) {
		return (
			<div className="flex gap-3 px-4">
				<StepRail color={dotColor} isFirst={isFirst} isLast={isLast} />
				<div className="min-w-0 flex-1 py-3">
					<div className="flex items-center gap-2">
						<span className="min-w-0 flex-1 truncate font-medium text-sm">
							{synthetic.title}
						</span>
						<span className="shrink-0 font-mono text-muted-foreground text-xs">
							{step.nodeId}
						</span>
					</div>
					<p className="mt-1 text-muted-foreground text-xs">
						{synthetic.detail}
					</p>
				</div>
			</div>
		);
	}

	const label = stepLabel(step);
	// step.summary is the rule's plain-English line: quiet inline when passed,
	// the prominent statement when failed. A historical run with no projection
	// falls back to the rule name — never a blank step.
	const line =
		step.summary ?? (step.ruleRef ? ruleFallback(step.ruleRef) : null);
	const failed = step.status === "fail";

	return (
		<div className="flex gap-3 px-4">
			<StepRail color={dotColor} isFirst={isFirst} isLast={isLast} />
			<div className="min-w-0 flex-1 py-3">
				<div className="flex items-center gap-2">
					<span className="shrink-0 truncate font-medium text-sm">{label}</span>
					<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
						{failed ? "" : line}
					</span>
					{/* Operator detail (§6): the exact id@version that ran — which logic
					    produced this verdict. Maintainers only; stripped from the public
					    contributor view. */}
					{maintainer && step.ruleRef ? (
						<span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
							{step.ruleRef}
						</span>
					) : null}
					<StepStatus status={step.status} />
					<span className="min-w-[6ch] shrink-0 text-right text-muted-foreground text-xs tabular-nums">
						{step.durationMs}ms
					</span>
				</div>
				{failed ? (
					<>
						{line ? (
							<p className="mt-2 font-medium text-[15px]/6 text-foreground">
								{line}
							</p>
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
		</div>
	);
}
