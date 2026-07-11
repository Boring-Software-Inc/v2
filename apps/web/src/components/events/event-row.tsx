import {
	GitPullRequestIcon,
	MessageMultiple01Icon,
	Upload04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EventKind, NormalizedEvent } from "@tripwire/contracts";
import { formatRelativeTime } from "#/lib/format-relative-time";

const KIND_LABEL: Record<EventKind, string> = {
	"change-request.opened": "change request opened",
	"change-request.updated": "change request updated",
	"change-request.closed": "change request closed",
	"comment.created": "comment",
	push: "push",
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

function subjectLine(event: NormalizedEvent): string {
	if (event.kind === "comment.created") {
		return `#${event.comment.subjectNumber}`;
	}
	if (event.kind === "push") {
		return event.push.ref.replace("refs/heads/", "");
	}
	return `#${event.changeRequest.number} ${event.changeRequest.title}`;
}

export function EventRow({ event }: { event: NormalizedEvent }) {
	return (
		<div className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-surface-1">
			<HugeiconsIcon
				icon={kindIcon(event.kind)}
				size={16}
				strokeWidth={1.8}
				className="shrink-0 text-muted-foreground"
			/>
			<img
				src={
					event.actor.avatarUrl ?? `https://github.com/${event.actor.login}.png`
				}
				alt={event.actor.login}
				className="size-5 shrink-0 rounded-full"
			/>
			<div className="min-w-0 flex-1">
				<div className="truncate">
					<span className="font-medium">{event.actor.login}</span>{" "}
					<span className="text-muted-foreground">
						{KIND_LABEL[event.kind]}
					</span>{" "}
					<span className="truncate">{subjectLine(event)}</span>
				</div>
				<div className="truncate text-muted-foreground text-xs">
					{event.repo.fullName}
				</div>
			</div>
			<span className="shrink-0 text-muted-foreground text-xs">
				{formatRelativeTime(event.occurredAt)}
			</span>
		</div>
	);
}
