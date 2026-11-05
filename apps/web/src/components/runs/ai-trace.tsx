import type { AiReviewTrace } from "@tripwire/contracts";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/design-system/ui/collapsible";
import { formatDuration } from "#/lib/run-chain";

const count = new Intl.NumberFormat("en-US");

export function AiTraceMeta({
	trace,
	durationMs,
}: {
	trace: AiReviewTrace;
	durationMs: number;
}) {
	const duration = formatDuration(durationMs);
	return (
		<div data-layout-role="ai-trace">
			<div className="type-caption" data-layout-role="ai-trace-counters">
				<span className="type-code-sm">{trace.model}</span>
				<span>{count.format(trace.usage.input)} tokens in</span>
				<span>{count.format(trace.usage.output)} out</span>
				{duration ? <span>{duration}</span> : null}
			</div>
			{trace.steps.length > 0 ? (
				<Collapsible data-layout-role="ai-trace-reasoning">
					<CollapsibleTrigger
						size="sm"
						summary={`${trace.stepsUsed} of ${trace.maxSteps} steps`}
					>
						Reasoning
					</CollapsibleTrigger>
					<CollapsibleContent hiddenUntilFound>
						<ol className="rounded-tag well" data-layout-role="ai-trace-steps">
							{trace.trimmed ? (
								<li
									className="type-caption"
									data-layout-role="ai-trace-trimmed"
								>
									Trimmed to the first {trace.steps.length} steps.
								</li>
							) : null}
							{trace.steps.map((step, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: trace steps are a fixed, ordered snapshot
								<li data-layout-role="ai-trace-step" key={i}>
									<span
										className="type-label-sm"
										data-layout-role="ai-trace-step-label"
									>
										{step.type === "tool_call" ? (
											<>
												Tool <span className="mono">{step.toolName ?? ""}</span>
											</>
										) : (
											"Reasoning"
										)}
									</span>
									<pre
										className="type-code-block whitespace-pre-wrap"
										data-layout-role="ai-trace-excerpt"
									>
										{step.excerpt}
										{step.truncated ? " [cut]" : ""}
									</pre>
								</li>
							))}
						</ol>
					</CollapsibleContent>
				</Collapsible>
			) : null}
		</div>
	);
}
