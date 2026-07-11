import type { AiReviewOutput } from "@tripwire/contracts";
import { aiReviewOutputSchema } from "@tripwire/contracts";
import { AiFindings } from "#/components/runs/ai-findings";
import { EvidenceView } from "#/components/runs/evidence-view";
import type { RunStepView } from "#/lib/runs.functions";
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
	const title =
		step.ruleRef ?? `${step.nodeKind}: ${step.nodeId.split(":").at(-1)}`;
	return (
		<div className="rounded-lg border bg-card px-4 py-3">
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"size-1.5 shrink-0 rounded-full",
						STATUS_DOT[step.status] ?? "bg-muted-foreground/40",
					)}
				/>
				<span className="font-medium font-mono text-sm">{title}</span>
				<span className="text-muted-foreground text-xs">{step.status}</span>
				<span className="ml-auto text-muted-foreground text-xs">
					{step.durationMs}ms
				</span>
			</div>
			{step.nodeKind === "rule" ? renderRuleEvidence(step) : null}
		</div>
	);
}
