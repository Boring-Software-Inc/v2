import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useState } from "react";
import { VerdictChip } from "#/components/activity/verdict-chip";
import type { ActivityGroup, ActivityItem } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { cn } from "#/lib/utils";

/** The event's own GitHub deep link (§9): PR, comment, or push compare. */
function entryUrl(event: NormalizedEvent): string | null {
	if ("changeRequest" in event) {
		return event.changeRequest.url;
	}
	if (event.kind === "comment.created") {
		return event.comment.url;
	}
	if (event.kind === "push") {
		return event.push.url ?? null;
	}
	return null;
}

function isTripwireComment(event: NormalizedEvent): boolean {
	return event.kind === "comment.created" && event.comment.byTripwire === true;
}

/** Constitution copy: "commented on #1", never "comment #3". */
function entryLabel(event: NormalizedEvent): string {
	switch (event.kind) {
		case "change-request.opened":
			return "opened";
		case "change-request.updated":
			return "pushed a change";
		case "change-request.closed":
			return "closed";
		case "comment.created":
			return `commented on #${event.comment.subjectNumber}`;
		case "push":
			return "pushed";
		default:
			return event.kind;
	}
}

/** A collapsed change request — the glance. Expands to its timeline. */
export function ActivityGroupRow({ group }: { group: ActivityGroup }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded-lg border bg-card">
			<button
				className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
				onClick={() => setOpen((v) => !v)}
				type="button"
			>
				<HugeiconsIcon
					className="shrink-0 text-muted-foreground"
					icon={open ? ArrowDown01Icon : ArrowRight01Icon}
					size={15}
					strokeWidth={2}
				/>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm">
						<span className="font-medium">#{group.subjectNumber}</span>{" "}
						<span className="truncate">{group.title}</span>
					</div>
					<div className="truncate text-muted-foreground text-xs">
						{group.actor.login} · {group.repoFullName}
					</div>
				</div>
				<VerdictChip verdict={group.currentVerdict} />
				<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
					{group.eventCount}
				</span>
				<span className="w-14 shrink-0 text-right text-muted-foreground text-xs">
					{formatRelativeTime(group.latestActivityAt)}
				</span>
			</button>

			{open ? (
				<div className="border-t px-3 py-1.5">
					{group.timeline.map((entry) => (
						<TimelineRow entry={entry} key={entry.event.id} />
					))}
				</div>
			) : null}
		</div>
	);
}

function TimelineRow({ entry }: { entry: ActivityItem }) {
	const { event, run, pending } = entry;
	const url = entryUrl(event);
	const ours = isTripwireComment(event);
	// A decision (a run) stands full; context (no run: exempt, push, comment)
	// dims so it never competes with the verdicts (§9).
	const dim = !run && !pending;
	const inner = (
		<div
			className={cn(
				"flex items-center gap-3 rounded-md py-1.5",
				dim && "opacity-55",
			)}
		>
			<span className="w-2 shrink-0">
				<span
					className={cn(
						"block size-1.5 rounded-full",
						run?.verdict === "block"
							? "bg-red-500"
							: run?.verdict === "pass"
								? "bg-emerald-500"
								: run?.verdict === "needs_review"
									? "bg-amber-500"
									: "bg-muted-foreground/40",
					)}
				/>
			</span>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-muted-foreground text-xs">
				<span className="text-foreground">
					{ours ? "tripwire" : event.actor.login}
				</span>
				{ours ? (
					<span className="rounded-sm bg-surface-1 px-1 py-px font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
						bot
					</span>
				) : null}
				<span className="truncate">{entryLabel(event)}</span>
				{run?.reason ? <span className="truncate"> · {run.reason}</span> : null}
			</span>
			{run ? (
				<VerdictChip verdict={run.verdict} />
			) : pending ? (
				<span className="shrink-0 animate-pulse text-muted-foreground text-xs">
					evaluating…
				</span>
			) : null}
			<span className="w-12 shrink-0 text-right text-muted-foreground text-xs">
				{formatRelativeTime(event.occurredAt)}
			</span>
		</div>
	);

	if (run) {
		return (
			<Link params={{ runId: run.runId }} to="/runs/$runId">
				{inner}
			</Link>
		);
	}
	if (url) {
		return (
			<a href={url} rel="noreferrer" target="_blank">
				{inner}
			</a>
		);
	}
	return inner;
}
