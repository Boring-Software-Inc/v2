import type { EventKind, NormalizedEvent } from "@tripwire/contracts";
import { runOutcome } from "#/components/activity/verdict-chip";
import { ForgeLinkButton } from "#/components/common/forge-link-button";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { Avatar } from "#/design-system/ui/avatar";
import { Badge } from "#/design-system/ui/badge";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "#/design-system/ui/item";
import { Status } from "#/design-system/ui/status";
import type { ActivityItem } from "#/lib/activity.functions";
import { eventForgeLink } from "#/lib/activity-links";

const KIND_LABEL = {
	"change-request.opened": "opened",
	"change-request.updated": "updated",
	"change-request.closed": "closed",
	"comment.created": "commented on",
	push: "pushed to",
	"schedule.matched": "schedule matched",
	"installation.created": "installed Tripwire on",
	"installation.deleted": "uninstalled Tripwire from",
	"installation-repositories.added": "gave Tripwire access to",
	"installation-repositories.removed": "took Tripwire access from",
} satisfies Record<EventKind, string>;

function subjectLine(event: NormalizedEvent): string {
	if (
		event.kind === "installation.created" ||
		event.kind === "installation.deleted" ||
		event.kind === "installation-repositories.added" ||
		event.kind === "installation-repositories.removed"
	) {
		return event.repositories.map((repo) => repo.fullName).join(", ");
	}
	if (event.kind === "comment.created") {
		return `#${event.comment.subjectNumber}`;
	}
	if (event.kind === "push") {
		return event.push.ref.replace("refs/heads/", "");
	}
	if (event.kind === "schedule.matched") {
		return `#${event.thread.number} ${event.thread.title}`;
	}
	return `#${event.changeRequest.number} ${event.changeRequest.title}`;
}

function noRunReason(event: NormalizedEvent): string {
	if (
		event.kind === "push" ||
		event.kind === "comment.created" ||
		event.kind === "schedule.matched" ||
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
	if (!event) {
		return (
			<Item>
				<ItemContent>
					<ItemTitle>
						{item.unavailableReason ?? "Historical event data is unavailable"}
					</ItemTitle>
				</ItemContent>
			</Item>
		);
	}
	const hasRun = run !== null;
	const forgeLink = eventForgeLink(event);

	const text =
		event.kind === "schedule.matched" ? (
			<>
				<span className="text-text-2">Schedule matched</span>{" "}
				{subjectLine(event)}
			</>
		) : (
			<>
				{event.actor.login}{" "}
				<span className="text-text-2">{KIND_LABEL[event.kind]}</span>{" "}
				{subjectLine(event)}
			</>
		);

	return (
		<Item data-feedback-name="ActivityRow">
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
					) : (
						<span>{text}</span>
					)}
				</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>
							{event.kind === "installation.created" ||
							event.kind === "installation.deleted" ||
							event.kind === "installation-repositories.added" ||
							event.kind === "installation-repositories.removed"
								? event.installation.account
								: event.repo.fullName}
						</span>
						{hasRun && run.reason ? <span>{run.reason}</span> : null}
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			<RowStatus
				kind={event.kind}
				pending={pending}
				reason={unarmed && !hasRun ? "Tripwire is off" : noRunReason(event)}
				run={run}
			/>
			<ItemMeta className="w-36 whitespace-nowrap text-end">
				<ZonedTime at={event.occurredAt} format="short" />
			</ItemMeta>
			<ItemActions className="w-14 justify-end">
				{forgeLink ? (
					<ForgeLinkButton forge={event.forge} link={forgeLink} />
				) : null}
			</ItemActions>
		</Item>
	);
}

function RowStatus({
	kind,
	run,
	pending,
	reason,
}: {
	kind: EventKind;
	run: ActivityItem["run"];
	pending?: boolean;
	reason: string;
}) {
	if (run || pending) {
		const verdict = runOutcome(kind, run);
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
