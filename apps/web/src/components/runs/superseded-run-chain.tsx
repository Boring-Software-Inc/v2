import { Link } from "@tanstack/react-router";
import {
	Check,
	ChevronDown,
	Close,
	Icon,
	Pending,
	Undo,
} from "#/components/glaze/icon";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { ZonedTime } from "#/components/timezones/zoned-time";
import type { RunLinkView } from "#/lib/runs.functions";
import { cn } from "#/lib/utils";

type RunHistoryTone = "superseded" | "pass" | "fail" | "pending";

function runHistoryTone(run: RunLinkView): RunHistoryTone {
	if (run.status === "queued" || run.status === "running") {
		return "pending";
	}
	if (run.verdict === "pass") {
		return "pass";
	}
	if (
		run.verdict === "block" ||
		run.verdict === "changes_required" ||
		run.verdict === "close"
	) {
		return "fail";
	}
	return "pending";
}

const TONE_LABEL = {
	superseded: "Superseded",
	pass: "Passed",
	fail: "Blocked",
	pending: "Checking",
} satisfies Record<RunHistoryTone, string>;

function RunMarker({
	selected,
	tone,
}: {
	selected: boolean;
	tone: RunHistoryTone;
}) {
	return (
		<span className="flex h-9 w-6 shrink-0 items-center justify-center">
			<span
				aria-hidden
				className={cn(
					"relative z-10 rounded-pill",
					selected && "size-2.5 border-2 border-[#F4F4F3] bg-[#0C0C0C]",
					!selected &&
						tone === "fail" &&
						"size-2 border-[1.5px] border-[#EC6F5A] bg-[#2C1714]",
					!selected &&
						tone === "pass" &&
						"size-2 border-[1.5px] border-[#60C98C] bg-[#102419]",
					!selected &&
						tone === "pending" &&
						"size-2 border-[1.5px] border-[#777777] bg-[#1F1F1F]",
				)}
			/>
		</span>
	);
}

function RunStatus({ tone }: { tone: RunHistoryTone }) {
	const icon = {
		superseded: Undo,
		pass: Check,
		fail: Close,
		pending: Pending,
	}[tone];
	return (
		<span className="flex h-9 w-7 shrink-0 items-center justify-end">
			<span
				className={cn(
					"flex size-[18px] shrink-0 items-center justify-center rounded-pill",
					tone === "superseded" && "bg-[#E8E8E7] text-[#161616]",
					tone === "fail" &&
						"border border-[#EC6F5A] bg-[#2C1714] text-[#EC6F5A]",
					tone === "pass" &&
						"border border-[#60C98C] bg-[#102419] text-[#60C98C]",
					tone === "pending" &&
						"border border-[#777777] bg-[#1F1F1F] text-[#A8A8A8]",
				)}
			>
				<Icon
					className={cn(
						tone === "fail" && "scale-[0.667]",
						tone === "pass" && "scale-75",
						(tone === "superseded" || tone === "pending") && "scale-[0.833]",
						tone === "pending" && "animate-spin motion-reduce:animate-none",
					)}
					icon={icon}
					size={12}
				/>
				<span className="sr-only">{TONE_LABEL[tone]}</span>
			</span>
		</span>
	);
}

export function SupersededRunChain({
	runs,
	selectedRunId,
	selectedRunIsSuperseded = true,
}: {
	runs: RunLinkView[];
	selectedRunId: string;
	selectedRunIsSuperseded?: boolean;
}) {
	const railHeight = Math.max(0, runs.length - 1) * 36;
	return (
		<Collapsible className="relative mt-3 w-full max-w-80" defaultOpen>
			<CollapsibleTrigger
				caret={false}
				className="h-7 min-h-7 gap-0 rounded-none p-0 type-caption font-medium text-[#A8A8A8] hover:bg-transparent active:bg-transparent"
			>
				<span className="flex items-center gap-1.5">
					{runs.length} runs in chain
					<Icon
						className="text-[#777777] transition-transform duration-(--dur-state) ease-out group-data-panel-open/collapsible-trigger:rotate-180 motion-reduce:transition-none"
						icon={ChevronDown}
						size={12}
					/>
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="relative w-full max-w-80 overflow-visible">
				<span
					aria-hidden
					className="pointer-events-none absolute top-0 -left-7 z-0 h-[18px] w-[41px] rounded-bl-[16px] border-b-[1.5px] border-l-[1.5px] border-[#45484B]"
				/>
				<span
					aria-hidden
					className="pointer-events-none absolute top-[18px] left-[11.25px] z-0 w-[1.5px] bg-[#45484B]"
					style={{ height: `${railHeight}px` }}
				/>
				<ol aria-label="Runs in this superseded chain">
					{runs.map((run) => {
						const selected = run.id === selectedRunId;
						const tone =
							selected && selectedRunIsSuperseded
								? "superseded"
								: runHistoryTone(run);
						return (
							<li
								className="relative z-10 flex h-9 w-full max-w-[284px] items-center"
								key={run.id}
							>
								<RunMarker selected={selected} tone={tone} />
								<Link
									aria-current={selected ? "page" : undefined}
									className={cn(
										"shrink-0 font-[system-ui] text-[13px] leading-5 underline decoration-1 underline-offset-[3px]",
										selected
											? "font-medium text-[#F4F4F3]"
											: "font-normal text-[#C8C8C7]",
									)}
									params={{ runId: run.id }}
									to="/runs/$runId"
								>
									Run from <ZonedTime at={run.createdAt} format="clock" />
								</Link>
								<RunStatus tone={tone} />
							</li>
						);
					})}
				</ol>
			</CollapsibleContent>
		</Collapsible>
	);
}
