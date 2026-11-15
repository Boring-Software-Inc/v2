import { Link } from "@tanstack/react-router";
import { Collapsible } from "@tripwire/ui/collapsible";
import {
	Check,
	ChevronDown,
	Close,
	Icon,
	Pending,
	Undo,
} from "@tripwire/ui/icon";
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
					selected && "size-2.5 border-2 chain-selected-mark",
					!selected &&
						tone === "fail" &&
						"size-2 border-[1.5px] chain-fail-mark",
					!selected &&
						tone === "pass" &&
						"size-2 border-[1.5px] chain-pass-mark",
					!selected &&
						tone === "pending" &&
						"size-2 border-[1.5px] chain-pending-mark",
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
					"flex shrink-0 items-center justify-center rounded-pill chain-status-mark",
					tone === "superseded" && "chain-node-fill",
					tone === "fail" && "border chain-fail-mark",
					tone === "pass" && "border chain-pass-mark",
					tone === "pending" && "border chain-pending-mark",
				)}
			>
				<span
					className={cn(
						tone === "fail" && "chain-status-icon-fail",
						tone === "pass" && "scale-75",
						(tone === "superseded" || tone === "pending") &&
							"chain-status-icon-muted",
					)}
				>
					<Icon
						icon={icon}
						motion={tone === "pending" ? "spin" : undefined}
						size={12}
					/>
				</span>
				<span className="sr-only">{TONE_LABEL[tone]}</span>
			</span>
		</span>
	);
}

export function SupersededRunChain({
	replaces,
	runs,
	selectedRunId,
	selectedRunIsSuperseded = true,
}: {
	replaces: RunLinkView | null;
	runs: RunLinkView[];
	selectedRunId: string;
	selectedRunIsSuperseded?: boolean;
}) {
	return (
		<div className="relative composition-top-small w-full max-w-80">
			<Collapsible
				trigger={
					<span className="flex items-center composition-gap-control">
						<Icon icon={Undo} size={12} />
						{replaces ? (
							<>
								Replaces the run from
								<span className="tone-content-primary underline decoration-1 underline-offset-4">
									<ZonedTime at={replaces.createdAt} format="clock" />
								</span>
							</>
						) : (
							`${runs.length} runs in chain`
						)}
						<span className="tone-muted-legacy transition-transform duration-(--dur-state) ease-out group-data-panel-open/collapsible-trigger:rotate-180 motion-reduce:transition-none">
							<Icon icon={ChevronDown} size={12} />
						</span>
					</span>
				}
				triggerTone="quiet"
			>
				<div className="relative w-full max-w-80 overflow-visible">
					<span
						aria-hidden
						className="pointer-events-none absolute top-0 -left-7 z-0 chain-glyph-height chain-mark-width chain-elbow chain-border"
					/>
					<span
						aria-hidden
						className="pointer-events-none absolute chain-connector-top chain-connector-offset z-0 chain-rail-width chain-connector"
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
									className="relative z-10 flex h-9 w-full chain-tooltip-width items-center"
									key={run.id}
								>
									<RunMarker selected={selected} tone={tone} />
									<Link
										aria-current={selected ? "page" : undefined}
										className={cn(
											"shrink-0 chain-system-type chain-text-size content-leading-standard underline decoration-1 chain-link-offset",
											selected
												? "chain-link-selected tone-content-inverse"
												: "chain-copy-tone",
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
				</div>
			</Collapsible>
		</div>
	);
}
