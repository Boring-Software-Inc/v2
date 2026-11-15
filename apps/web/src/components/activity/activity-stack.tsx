import type { NormalizedEvent } from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMeta,
	ItemTitle,
} from "@tripwire/ui/item";
import { Status, StatusMark, type StatusValue } from "@tripwire/ui/status";
import { useState } from "react";
import {
	groupOutcome,
	runOutcome,
	VerdictChip,
} from "#/components/activity/verdict-chip";
import { EntityCard } from "#/components/common/entity-card";
import { ForgeLinkButton } from "#/components/common/forge-link-button";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { ZonedTime } from "#/components/timezones/zoned-time";
import type { ActivityGroup, ActivityItem } from "#/lib/activity.functions";
import { changeRequestForgeLink, eventForgeLink } from "#/lib/activity-links";

const VISIBLE = 10;

function isTripwireComment(event: NormalizedEvent): boolean {
	return event.kind === "comment.created" && event.comment.byTripwire === true;
}

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

export function ActivityStack({ group }: { group: ActivityGroup }) {
	const [showAll, setShowAll] = useState(false);
	const entries = group.timeline;
	const canTruncate = entries.length > VISIBLE;
	const visible = canTruncate && !showAll ? entries.slice(0, VISIBLE) : entries;
	const hidden = entries.length - VISIBLE;

	return (
		<EntityCard
			feedbackName="ActivityStack"
			description={<StackDescription group={group} />}
			flush
			footerActions={
				canTruncate ? (
					<Button
						onAction={() => setShowAll((v) => !v)}
						size="small"
						variant="secondary"
					>
						{showAll ? "Show fewer events" : `Show ${hidden} more events`}
					</Button>
				) : undefined
			}
			footerMeta={
				canTruncate
					? showAll
						? `${entries.length} events`
						: `${VISIBLE} of ${entries.length} events`
					: undefined
			}
			status={<StackStatus group={group} />}
			title={<StackTitle group={group} />}
		>
			<ItemGroup
				aria-label={`Timeline of #${group.subjectNumber}`}
				data-layout-role="activity-timeline"
				variant="plain"
			>
				{visible.map((entry) => (
					<EntryRow
						entry={entry}
						groupRunId={group.currentRunId}
						groupUrl={group.url}
						key={entry.eventId}
					/>
				))}
			</ItemGroup>
		</EntityCard>
	);
}

function StackTitle({ group }: { group: ActivityGroup }) {
	const title = `#${group.subjectNumber} ${group.title}`;
	if (group.currentRunId) {
		return (
			<ItemRouterLink params={{ runId: group.currentRunId }} to="/runs/$runId">
				{title}
			</ItemRouterLink>
		);
	}
	return title;
}

function StackDescription({ group }: { group: ActivityGroup }) {
	return (
		<MetaRow wrap>
			<span>{group.actor.login}</span>
			<span>{group.repoFullName}</span>
			<ZonedTime at={group.latestActivityAt} format="short" />
		</MetaRow>
	);
}

function StackStatus({ group }: { group: ActivityGroup }) {
	const evaluating = group.currentRunId != null && group.currentVerdict == null;
	const forge = group.timeline.find((entry) => entry.event)?.event?.forge;
	const forgeLink = forge
		? changeRequestForgeLink(forge, group.subjectNumber, group.url)
		: null;
	return (
		<>
			{evaluating ? (
				<Status size="small" status="running">
					Checking again
				</Status>
			) : (
				<VerdictChip outcome={groupOutcome(group)} />
			)}
			{forge && forgeLink ? (
				<ForgeLinkButton forge={forge} link={forgeLink} />
			) : null}
		</>
	);
}

function EntryRow({
	entry,
	groupRunId,
	groupUrl,
}: {
	entry: ActivityItem;
	groupRunId: string | null;
	groupUrl: string | null;
}) {
	const { event, run, pending } = entry;
	if (!event) {
		return (
			<Item density="compact">
				<ItemContent>
					<ItemTitle>
						{entry.unavailableReason ?? "Historical event data is unavailable"}
					</ItemTitle>
				</ItemContent>
			</Item>
		);
	}
	const ours = isTripwireComment(event);
	const runId = run?.runId ?? groupRunId;
	const eventLink = eventForgeLink(event);
	const forgeLink = eventLink?.href === groupUrl ? null : eventLink;
	const reevaluating = run?.status === "queued" || run?.status === "running";
	const note = reevaluating ? "Checking again" : (run?.reason ?? null);
	const text = (
		<MetaRow className="@max-lg/activity-timeline:flex-wrap @max-lg/activity-timeline:*:min-w-0 @max-lg/activity-timeline:*:max-w-full @max-lg/activity-timeline:*:shrink @max-lg/activity-timeline:*:overflow-visible @max-lg/activity-timeline:*:whitespace-normal @max-lg/activity-timeline:*:wrap-anywhere">
			{event.kind === "schedule.matched" ? (
				<span>Matched by schedule</span>
			) : (
				<span>
					{ours ? "Tripwire" : event.actor.login}{" "}
					<span className="tone-content-secondary">{entryLabel(event)}</span>
				</span>
			)}
			{note ? <span className="tone-content-secondary">{note}</span> : null}
		</MetaRow>
	);

	return (
		<Item data-layout-role="activity-timeline-row" density="compact">
			<ItemContent data-layout-role="activity-timeline-main">
				<ItemTitle>
					{runId ? (
						<ItemRouterLink params={{ runId }} to="/runs/$runId">
							{text}
						</ItemRouterLink>
					) : (
						<span>{text}</span>
					)}
					{ours ? <Badge size="small">Bot</Badge> : null}
				</ItemTitle>
			</ItemContent>
			<div data-layout-role="activity-timeline-meta-cluster">
				<EntryOutcome
					outcome={
						runOutcome(event.kind, run) ??
						(pending ? { status: "running", label: "Checking" } : undefined)
					}
				/>
				<ItemMeta data-layout-role="activity-timeline-time">
					<ZonedTime at={event.occurredAt} format="short" />
				</ItemMeta>
				<ItemActions data-layout-role="activity-timeline-actions">
					{forgeLink ? (
						<ForgeLinkButton forge={event.forge} link={forgeLink} />
					) : null}
				</ItemActions>
			</div>
		</Item>
	);
}

function EntryOutcome({
	outcome,
}: {
	outcome: { status: StatusValue; label: string } | undefined;
}) {
	return (
		<span title={outcome?.label}>
			{outcome ? (
				<StatusMark label={outcome.label} status={outcome.status} />
			) : null}
		</span>
	);
}
