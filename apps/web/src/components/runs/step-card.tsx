import type { AiReviewOutput } from "@tripwire/contracts";
import { aiReviewOutputSchema } from "@tripwire/contracts";
import { AiFindings } from "#/components/runs/ai-findings";
import { EvidenceView } from "#/components/runs/evidence-view";
import type { RunStepView } from "#/lib/runs.functions";
import { describeSyntheticStep } from "#/lib/synthetic-steps";
import { cn } from "#/lib/utils";

const STATUS_DOT: Record<string, string> = {
	pass: "bg-emerald-500",
	fail: "bg-red-500",
	skipped: "bg-muted-foreground/40",
	paused: "bg-amber-500",
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
};

function extractReview(evidence: unknown): AiReviewOutput | null {
	if (
		evidence &&
		typeof evidence === "object" &&
		"evidence" in evidence &&
		evidence.evidence &&
		typeof evidence.evidence === "object" &&
		"output" in evidence.evidence
	) {
		const parsed = aiReviewOutputSchema.safeParse(evidence.evidence.output);
		return parsed.success ? parsed.data : null;
	}
	return null;
}

function renderRuleEvidence(
	step: RunStepView,
	repo: string,
	sha: string | null,
) {
	if (step.ruleRef?.startsWith("ai-review@")) {
		const output = extractReview(step.evidence);
		if (output) {
			return <AiFindings output={output} repo={repo} sha={sha} />;
		}
	}
	return <EvidenceView evidence={step.evidence} />;
}

/** The step's display label: rule ref in mono, ai-review as its friendly name,
 * a non-rule node as its bare kind (never "trigger: trigger"). */
function stepLabel(step: RunStepView): { text: string; mono: boolean } {
	if (step.ruleRef) {
		if (step.ruleRef.startsWith("ai-review@")) {
			return { text: "ai review", mono: false };
		}
		return { text: step.ruleRef, mono: true };
	}
	return { text: step.nodeId.split(":").at(-1) ?? step.nodeKind, mono: false };
}

/** The status badge — the only saturated element in a step; hugs its text. */
function StepStatus({ status }: { status: string }) {
	const chip = STATUS_CHIP[status];
	if (!chip) {
		return null;
	}
	return (
		<span
			className={cn(
				"shrink-0 rounded-full px-2 py-0.5 font-medium text-xs",
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
}: {
	step: RunStepView;
	isFirst: boolean;
	isLast: boolean;
	repo: string;
	sha: string | null;
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
	// the prominent statement when failed.
	const line = step.summary ?? null;
	const failed = step.status === "fail";

	return (
		<div className="flex gap-3 px-4">
			<StepRail color={dotColor} isFirst={isFirst} isLast={isLast} />
			<div className="min-w-0 flex-1 py-3">
				<div className="flex items-center gap-2">
					<span
						className={cn(
							"shrink-0 truncate font-medium text-sm",
							label.mono && "font-mono",
						)}
					>
						{label.text}
					</span>
					<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
						{failed ? "" : line}
					</span>
					<StepStatus status={step.status} />
					<span className="shrink-0 text-muted-foreground text-xs">
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
						{step.nodeKind === "rule"
							? renderRuleEvidence(step, repo, sha)
							: null}
					</>
				) : null}
			</div>
		</div>
	);
}
