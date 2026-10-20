import type { AiReviewTrace } from "@tripwire/contracts";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";

export function AiTraceDisclosure({ trace }: { trace: AiReviewTrace }) {
	return (
		<Collapsible className="mt-2 flex flex-col gap-1.5">
			<CollapsibleTrigger
				size="sm"
				summary={`${trace.stepsUsed} of ${trace.maxSteps} steps`}
			>
				Reasoning trace
			</CollapsibleTrigger>
			<CollapsibleContent hiddenUntilFound>
				<div className="flex flex-col gap-2 rounded-tag bg-code-surface p-2">
					<div className="flex flex-wrap gap-x-4 gap-y-1 type-caption text-text-2 tabular-nums">
						<span>
							steps {trace.stepsUsed}/{trace.maxSteps}
						</span>
						<span>in {trace.usage.input}</span>
						<span>out {trace.usage.output}</span>
						<span>cached {trace.usage.cached ?? "n/a"}</span>
						<span className="mono text-text-3">{trace.model}</span>
					</div>
					{trace.trimmed ? (
						<p className="type-caption text-text-3">
							Trace trimmed to the first {trace.steps.length} steps.
						</p>
					) : null}
					<ol className="flex flex-col gap-2">
						{trace.steps.map((step, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: trace steps are a static, ordered, never-reordered snapshot
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
								<pre className="type-code-block whitespace-pre-wrap wrap-break-word text-text-2">
									{step.excerpt}
									{step.truncated ? " …[truncated]" : ""}
								</pre>
							</li>
						))}
					</ol>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
