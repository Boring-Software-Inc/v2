import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { EventKind, NormalizedEvent } from "@tripwire/contracts";
import { useState } from "react";
import { VerdictChip } from "#/components/activity/verdict-chip";
import type { ActivityGroup, ActivityItem } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { cn } from "#/lib/utils";

const ENTRY_LABEL: Record<EventKind, string> = {
	"change-request.opened": "opened",
	"change-request.updated": "updated",
	"change-request.closed": "closed",
	"comment.created": "commented",
	push: "pushed",
	"installation.created": "installed the app",
	"installation.deleted": "uninstalled the app",
	"installation-repositories.added": "granted repos",
	"installation-repositories.removed": "revoked repos",
};

function entryUrl(event: NormalizedEvent): string | null {
	if ("changeRequest" in event) {
		return event.changeRequest.url;
	}
	if (event.kind === "comment.created") {
		return event.comment.url;
	}
	return null;
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
	const inner = (
		<div className="flex items-center gap-3 rounded-md py-1.5">
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
			<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
				<span className="text-foreground">{event.actor.login}</span>{" "}
				{ENTRY_LABEL[event.kind]}
				{run?.reason ? <span> · {run.reason}</span> : null}
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
