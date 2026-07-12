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

export function StepCard({ step }: { step: RunStepView }) {
	const synthetic = describeSyntheticStep(step);
	if (synthetic) {
		return (
			<div className="px-4 py-3">
				<div className="flex items-center gap-2.5">
					<span
						className={cn(
							"size-1.5 shrink-0 rounded-full",
							synthetic.kind === "deny-floor" ? "bg-red-500" : "bg-amber-500",
						)}
					/>
					<span className="font-medium text-sm">{synthetic.title}</span>
					<span className="ml-auto font-mono text-muted-foreground text-xs">
						{step.nodeId}
					</span>
				</div>
				<p className="mt-1 pl-4 text-muted-foreground text-xs">
					{synthetic.detail}
				</p>
			</div>
		);
	}
	const title =
		step.ruleRef ?? `${step.nodeKind}: ${step.nodeId.split(":").at(-1)}`;
	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-2.5">
				<span
					className={cn(
						"size-1.5 shrink-0 rounded-full",
						STATUS_DOT[step.status] ?? "bg-muted-foreground/40",
					)}
				/>
				<span className="min-w-0 flex-1 truncate font-medium font-mono text-sm">
					{title}
				</span>
				<StepStatus status={step.status} />
				<span className="w-14 shrink-0 text-right text-muted-foreground text-xs">
					{step.durationMs}ms
				</span>
			</div>
			{step.nodeKind === "rule" ? renderRuleEvidence(step) : null}
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
