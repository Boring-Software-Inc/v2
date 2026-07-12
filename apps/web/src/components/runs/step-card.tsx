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

function renderRuleEvidence(step: RunStepView) {
	if (step.ruleRef?.startsWith("ai-review@")) {
		const output = extractReview(step.evidence);
		if (output) {
			return <AiFindings output={output} />;
		}
	}
	return <EvidenceView evidence={step.evidence} />;
}

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
}: {
	step: RunStepView;
	isFirst: boolean;
	isLast: boolean;
}) {
	const synthetic = describeSyntheticStep(step);
	const dotColor = synthetic
		? synthetic.kind === "deny-floor"
			? "bg-red-500"
			: "bg-amber-500"
		: (STATUS_DOT[step.status] ?? "bg-muted-foreground/40");
	const title =
		step.ruleRef ?? `${step.nodeKind}: ${step.nodeId.split(":").at(-1)}`;

	return (
		<div className="flex gap-3 px-4">
			<StepRail color={dotColor} isFirst={isFirst} isLast={isLast} />
			<div className="min-w-0 flex-1 py-3">
				{synthetic ? (
					<>
						<div className="flex items-center gap-2.5">
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
					</>
				) : (
					<>
						<div className="flex items-center gap-2.5">
							<span className="min-w-0 flex-1 truncate font-medium font-mono text-sm">
								{title}
							</span>
							<StepStatus status={step.status} />
							<span className="w-11 shrink-0 text-right text-muted-foreground text-xs">
								{step.durationMs}ms
							</span>
						</div>
						{step.nodeKind === "rule" ? renderRuleEvidence(step) : null}
					</>
				)}
			</div>
		</div>
	);
}

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

/** Fixed-width status column so chips line up across steps (matches the feed). */
function StepStatus({ status }: { status: string }) {
	const chip = STATUS_CHIP[status];
	if (!chip) {
		return <span className="w-[60px] shrink-0" />;
	}
	return (
		<span
			className={cn(
				"inline-flex w-[60px] shrink-0 items-center justify-center rounded-full py-0.5 text-center font-medium text-xs",
				chip.className,
			)}
		>
			{chip.label}
		</span>
	);
}
