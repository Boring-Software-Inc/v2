import type { AiReviewTrace } from "@tripwire/contracts";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";

const count = new Intl.NumberFormat("en-US");

export function AiTraceMeta({
	trace,
	durationMs,
}: {
	trace: AiReviewTrace;
	durationMs: number;
}) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 type-caption text-text-2">
				<span className="type-code-sm">{trace.model}</span>
				<span>{count.format(trace.usage.input)} tokens in</span>
				<span>{count.format(trace.usage.output)} out</span>
				<span>{durationMs}ms</span>
			</div>
			{trace.steps.length > 0 ? (
				<Collapsible className="flex flex-col gap-2">
					<CollapsibleTrigger
						size="sm"
						summary={`${trace.stepsUsed} of ${trace.maxSteps} steps`}
					>
						Reasoning
					</CollapsibleTrigger>
					<CollapsibleContent hiddenUntilFound>
						<ol className="flex flex-col gap-2 rounded-tag well p-2">
							{trace.trimmed ? (
								<li className="type-caption text-text-2">
									Trimmed to the first {trace.steps.length} steps.
								</li>
							) : null}
							{trace.steps.map((step, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: trace steps are a fixed, ordered snapshot
								<li className="flex flex-col gap-0.5" key={i}>
									<span className="type-label-sm text-text-2">
										{step.type === "tool_call" ? (
											<>
												Tool <span className="mono">{step.toolName ?? ""}</span>
											</>
										) : (
											"Reasoning"
										)}
									</span>
									<pre className="type-code-block whitespace-pre-wrap [overflow-wrap:anywhere] text-text-2">
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
