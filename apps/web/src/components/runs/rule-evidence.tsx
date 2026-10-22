import {
	type AiReviewOutput,
	type AiReviewTrace,
	aiReviewOutputSchema,
	aiReviewTraceSchema,
	ruleIdOf,
} from "@tripwire/contracts";
import { z } from "zod";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { JsonView } from "#/components/glaze/ui/json-view";
import { AiFindings } from "#/components/runs/ai-findings";
import { AiTraceMeta } from "#/components/runs/ai-trace";
import { CryptoMatches, FileRows } from "#/components/runs/evidence-parts";
import type { JsonValue, RunStepView } from "#/lib/runs.functions";

const envelopeSchema = z.object({ evidence: z.json() });
const matchesSchema = z
	.object({
		matches: z.array(z.object({ value: z.string(), location: z.string() })),
	})
	.catch({ matches: [] });
const touchedSchema = z
	.object({ touched: z.array(z.string()) })
	.catch({ touched: [] });
const reviewSchema = z
	.object({ output: aiReviewOutputSchema.nullable().catch(null) })
	.catch({ output: null });
const traceSchema = z
	.object({ trace: aiReviewTraceSchema.nullable().catch(null) })
	.catch({ trace: null });

function innerEvidence(evidence: JsonValue): JsonValue {
	const envelope = envelopeSchema.safeParse(evidence);
	return envelope.success ? envelope.data.evidence : evidence;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

interface EvidenceDetail {
	label: string;
	body: React.ReactNode;
}

function aiDetail(
	output: AiReviewOutput | null,
	trace: AiReviewTrace | null,
	step: RunStepView,
	repo: string,
	sha: string | null,
): EvidenceDetail | null {
	const findings = output?.findings.length ?? 0;
	if (findings === 0 && !trace) {
		return null;
	}
	const count = plural(findings, "finding", "findings");
	return {
		label: trace ? (findings > 0 ? `Trace, ${count}` : "Trace") : count,
		body: (
			<>
				{output ? <AiFindings output={output} repo={repo} sha={sha} /> : null}
				{trace ? (
					<AiTraceMeta durationMs={step.durationMs} trace={trace} />
				) : null}
			</>
		),
	};
}

export function RuleEvidence({
	step,
	repo,
	sha,
	maintainer,
}: {
	step: RunStepView;
	repo: string;
	sha: string | null;
	maintainer: boolean;
}) {
	const inner = innerEvidence(step.evidence);
	const ruleId = step.ruleRef ? ruleIdOf(step.ruleRef) : null;
	let detail: EvidenceDetail | null = null;
	if (ruleId === "ai-review") {
		detail = aiDetail(
			reviewSchema.parse(inner).output,
			maintainer ? traceSchema.parse(inner).trace : null,
			step,
			repo,
			sha,
		);
	} else if (ruleId === "crypto-address") {
		const { matches } = matchesSchema.parse(inner);
		detail =
			matches.length > 0
				? {
						label: `Evidence, ${plural(matches.length, "match", "matches")}`,
						body: <CryptoMatches matches={matches} />,
					}
				: null;
	} else if (ruleId === "honeypot") {
		const { touched } = touchedSchema.parse(inner);
		detail =
			touched.length > 0
				? {
						label: `Evidence, ${plural(touched.length, "file", "files")}`,
						body: <FileRows files={touched} repo={repo} sha={sha} />,
					}
				: null;
	}
	const raw = maintainer && inner !== null;
	if (!(detail || raw)) {
		return null;
	}
	return (
		<Collapsible className="pt-1">
			<CollapsibleTrigger size="sm">
				{detail?.label ?? "Evidence"}
			</CollapsibleTrigger>
			<CollapsibleContent hiddenUntilFound>
				<div className="flex flex-col gap-2 pt-2">
					{detail?.body}
					{raw && detail ? (
						<Collapsible>
							<CollapsibleTrigger size="sm">Raw evidence</CollapsibleTrigger>
							<CollapsibleContent>
								<div className="pt-2">
									<JsonView data={inner} label="Raw evidence" />
								</div>
							</CollapsibleContent>
						</Collapsible>
					) : null}
					{raw && !detail ? (
						<JsonView data={inner} label="Raw evidence" />
					) : null}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
