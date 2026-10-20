import type { EventKind, NormalizedEvent } from "@tripwire/contracts";
import { verdictStatus } from "#/components/activity/verdict-chip";
import { ItemRouterLink } from "#/components/common/router-links";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Badge } from "#/components/glaze/ui/badge";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemLink,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { Status } from "#/components/glaze/ui/status";
import type { ActivityItem } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";

const KIND_LABEL: Record<EventKind, string> = {
	"change-request.opened": "opened",
	"change-request.updated": "updated",
	"change-request.closed": "closed",
	"comment.created": "commented on",
	push: "pushed to",
	"installation.created": "installed Tripwire on",
	"installation.deleted": "uninstalled Tripwire from",
	"installation-repositories.added": "gave Tripwire access to",
	"installation-repositories.removed": "took Tripwire access from",
};

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

function noRunReason(event: NormalizedEvent): string {
	if (
		event.kind === "push" ||
		event.kind === "comment.created" ||
		event.kind.startsWith("installation")
	) {
		return "Not checked";
	}
	return "Maintainer, not checked";
}

export function ActivityRow({
	item,
	unarmed,
}: {
	item: ActivityItem;
	unarmed?: boolean;
}) {
	const { event, run, pending } = item;
	const hasRun = run !== null;
	const url = eventUrl(event);

	const text = (
		<>
			{event.actor.login}{" "}
			<span className="text-text-2">{KIND_LABEL[event.kind]}</span>{" "}
			{subjectLine(event)}
		</>
	);

	return (
		<Item>
			<ItemMedia>
				<Avatar
					decorative
					name={event.actor.login}
					size="xs"
					src={
						event.actor.avatarUrl ??
						`https://github.com/${event.actor.login}.png`
					}
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					{hasRun ? (
						<ItemRouterLink params={{ runId: run.runId }} to="/runs/$runId">
							{text}
						</ItemRouterLink>
					) : url ? (
						<ItemLink href={url} rel="noreferrer" target="_blank">
							{text}
						</ItemLink>
					) : (
						<span>{text}</span>
					)}
				</ItemTitle>
				<ItemDescription className="truncate">
					{"repo" in event ? event.repo.fullName : event.installation.account}
					{hasRun && run.reason ? ` · ${run.reason}` : ""}
				</ItemDescription>
			</ItemContent>
			<RowStatus
				pending={pending}
				reason={unarmed && !hasRun ? "Tripwire is off" : noRunReason(event)}
				run={run}
			/>
			<ItemMeta className="w-14 text-end">
				{formatRelativeTime(event.occurredAt)}
			</ItemMeta>
		</Item>
	);
}

function RowStatus({
	run,
	pending,
	reason,
}: {
	run: ActivityItem["run"];
	pending?: boolean;
	reason: string;
}) {
	if (run || pending) {
		const verdict = verdictStatus(run?.verdict);
		return verdict ? (
			<Status size="sm" status={verdict.status}>
				{verdict.label}
			</Status>
		) : (
			<Status size="sm" status="running">
				Checking
			</Status>
		);
	}
	return <Badge variant="outline">{reason}</Badge>;
}
