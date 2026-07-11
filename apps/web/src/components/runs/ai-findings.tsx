import type { AiReviewOutput } from "@tripwire/contracts";
import { cn } from "#/lib/utils";

const SEVERITY_DOT: Record<string, string> = {
	critical: "bg-red-500",
	warn: "bg-amber-500",
	info: "bg-muted-foreground/40",
};

/** §8 — findings render on the run page; the PR comment never carries them. */
export function AiFindings({ output }: { output: AiReviewOutput }) {
	return (
		<div className="mt-2 rounded-md bg-surface-1 px-3 py-2">
			<p className="text-sm">
				{output.summary}{" "}
				<span className="text-muted-foreground text-xs">
					({Math.round(output.confidence * 100)}% confident)
				</span>
			</p>
			{output.findings.length > 0 ? (
				<ul className="mt-2 flex flex-col gap-1">
					{output.findings.map((finding) => (
						<li
							className="flex items-baseline gap-2 text-xs"
							key={`${finding.file}-${finding.line ?? 0}-${finding.note}`}
						>
							<span
								className={cn(
									"size-1.5 shrink-0 translate-y-[-1px] rounded-full",
									SEVERITY_DOT[finding.severity],
								)}
							/>
							<span className="font-mono">
								{finding.file}
								{finding.line ? `:${finding.line}` : ""}
							</span>
							<span className="text-muted-foreground">{finding.note}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
