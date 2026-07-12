import {
	GitPullRequestIcon,
	MessageMultiple01Icon,
	Upload04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { EventKind, NormalizedEvent } from "@tripwire/contracts";
import type { ActivityItem } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { cn } from "#/lib/utils";

const KIND_LABEL: Record<EventKind, string> = {
	"change-request.opened": "change request opened",
	"change-request.updated": "change request updated",
	"change-request.closed": "change request closed",
	"comment.created": "comment",
	push: "push",
	"installation.created": "installed the app",
	"installation.deleted": "uninstalled the app",
	"installation-repositories.added": "granted repos",
	"installation-repositories.removed": "revoked repos",
};

function kindIcon(kind: EventKind) {
	if (kind === "comment.created") {
		return MessageMultiple01Icon;
	}
	if (kind === "push") {
		return Upload04Icon;
	}
	return GitPullRequestIcon;
}

/** The event's own GitHub deep link — the fallback target when no run (§9). */
function eventUrl(event: NormalizedEvent): string | null {
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

function subjectLine(event: NormalizedEvent): string {
	if ("installation" in event) {
		return event.repositories.map((repo) => repo.fullName).join(", ");
	}
	if (event.kind === "comment.created") {
		return `#${event.comment.subjectNumber}`;
	}
	if (event.kind === "push") {
		return event.push.ref.replace("refs/heads/", "");
	}
	return `#${event.changeRequest.number} ${event.changeRequest.title}`;
}

const VERDICT: Record<string, { label: string; className: string }> = {
	block: {
		label: "blocked",
		className: "bg-red-500/10 text-red-600 dark:text-red-400",
	},
	pass: {
		label: "passed",
		className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	},
	needs_review: {
		label: "review",
		className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	},
};

/** Why nothing ran, derived from the event kind (§6 gate targets). */
function noRunReason(event: NormalizedEvent): string {
	if (event.kind === "push") {
		return "push";
	}
	if (event.kind === "comment.created") {
		return "comment";
	}
	if (event.kind.startsWith("installation")) {
		return "installation";
	}
	return "maintainer — exempt";
}

export function ActivityRow({ item }: { item: ActivityItem }) {
	const { event, run, pending } = item;
	const hasRun = run !== null;

	const inner = (
		<div
			className={cn(
				"flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors",
				hasRun ? "hover:bg-surface-1" : "opacity-60",
			)}
		>
			<HugeiconsIcon
				icon={kindIcon(event.kind)}
				size={16}
				strokeWidth={1.8}
				className="shrink-0 text-muted-foreground"
			/>
			<img
				alt={event.actor.login}
				className="size-5 shrink-0 rounded-full"
				src={
					event.actor.avatarUrl ?? `https://github.com/${event.actor.login}.png`
				}
			/>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm">
					<span className="font-medium">{event.actor.login}</span>{" "}
					<span className="text-muted-foreground">
						{KIND_LABEL[event.kind]}
					</span>{" "}
					<span className="truncate">{subjectLine(event)}</span>
				</div>
				<div className="truncate text-muted-foreground text-xs">
					{"repo" in event ? event.repo.fullName : event.installation.account}
					{hasRun && run.reason ? ` · ${run.reason}` : ""}
				</div>
			</div>

			<Status pending={pending} run={run} reason={noRunReason(event)} />

			<span className="w-14 shrink-0 text-right text-muted-foreground text-xs">
				{formatRelativeTime(event.occurredAt)}
			</span>
		</div>
	);

	if (hasRun) {
		return (
			<Link params={{ runId: run.runId }} to="/runs/$runId">
				{inner}
			</Link>
		);
	}
	const url = eventUrl(event);
	if (url) {
		return (
			<a href={url} rel="noreferrer" target="_blank">
				{inner}
			</a>
		);
	}
	return inner;
}

function Status({
	run,
	pending,
	reason,
}: {
	run: ActivityItem["run"];
	pending?: boolean;
	reason: string;
}) {
	if (run) {
		const verdict = run.verdict ? VERDICT[run.verdict] : undefined;
		return verdict ? (
			<span
				className={cn(
					"shrink-0 rounded-full px-2 py-0.5 font-medium text-xs",
					verdict.className,
				)}
			>
				{verdict.label}
			</span>
		) : (
			<span className="shrink-0 text-muted-foreground text-xs">
				evaluating…
			</span>
		);
	}
	if (pending) {
		return (
			<span className="shrink-0 animate-pulse text-muted-foreground text-xs">
				evaluating…
			</span>
		);
	}
	return (
		<span className="shrink-0 rounded-full bg-surface-1 px-2 py-0.5 text-muted-foreground text-xs">
			{reason}
		</span>
	);
}
