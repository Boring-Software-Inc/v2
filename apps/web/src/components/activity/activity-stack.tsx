import { Link } from "@tanstack/react-router";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useState } from "react";
import { VerdictChip, verdictStatus } from "#/components/activity/verdict-chip";
import { EntityCard } from "#/components/common/entity-card";
import { ForgeLinkButton } from "#/components/common/forge-link-button";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
import {
	Status,
	StatusMark,
	type StatusValue,
	statusVariants,
} from "#/components/glaze/ui/status";
import type { ActivityGroup, ActivityItem } from "#/lib/activity.functions";
import { changeRequestForgeLink, eventForgeLink } from "#/lib/activity-links";
import { formatRelativeTime } from "#/lib/format-relative-time";

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
			description={<StackDescription group={group} />}
			flush
			footerActions={
				canTruncate ? (
					<Button
						onClick={() => setShowAll((v) => !v)}
						size="sm"
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
				variant="plain"
			>
				{visible.map((entry) => (
					<EntryRow entry={entry} groupUrl={group.url} key={entry.event.id} />
				))}
			</ItemGroup>
		</EntityCard>
	);
}

function StackTitle({ group }: { group: ActivityGroup }) {
	const title = (
		<>
			#{group.subjectNumber} {group.title}
		</>
	);
	if (group.currentRunId) {
		return (
			<Link
				className="hover:underline"
				params={{ runId: group.currentRunId }}
				to="/runs/$runId"
			>
				{title}
			</Link>
		);
	}
	return title;
}

function StackDescription({ group }: { group: ActivityGroup }) {
	return (
		<MetaRow>
			<span>{group.actor.login}</span>
			<span>{group.repoFullName}</span>
			<span>{formatRelativeTime(group.latestActivityAt)}</span>
		</MetaRow>
	);
}

function StackStatus({ group }: { group: ActivityGroup }) {
	const evaluating = group.currentRunId != null && group.currentVerdict == null;
	const forge = group.timeline[0]?.event.forge;
	const forgeLink = forge
		? changeRequestForgeLink(forge, group.subjectNumber, group.url)
		: null;
	return (
		<>
			{evaluating ? (
				<Status size="sm" status="running">
					Checking again
				</Status>
			) : (
				<VerdictChip verdict={group.currentVerdict} />
			)}
			{forge && forgeLink ? (
				<ForgeLinkButton forge={forge} link={forgeLink} />
			) : null}
		</>
	);
}

function EntryRow({
	entry,
	groupUrl,
}: {
	entry: ActivityItem;
	groupUrl: string | null;
}) {
	const { event, run, pending } = entry;
	const ours = isTripwireComment(event);
	const runId = run?.runId ?? null;
	const eventLink = runId ? null : eventForgeLink(event);
	const forgeLink = eventLink?.href === groupUrl ? null : eventLink;
	const reevaluating = run?.status === "queued" || run?.status === "running";
	const note = reevaluating ? "Checking again" : (run?.reason ?? null);
	const text = (
		<MetaRow>
			<span>
				{ours ? "Tripwire" : event.actor.login}{" "}
				<span className="text-text-2">{entryLabel(event)}</span>
			</span>
			{note ? <span className="text-text-2">{note}</span> : null}
		</MetaRow>
	);

	return (
		<Item size="sm">
			<ItemContent>
				<ItemTitle>
					{runId ? (
						<ItemRouterLink params={{ runId }} to="/runs/$runId">
							{text}
						</ItemRouterLink>
					) : (
						<span>{text}</span>
					)}
					{ours ? <Badge size="sm">Bot</Badge> : null}
				</ItemTitle>
			</ItemContent>
			<EntryOutcome
				outcome={
					verdictStatus(run?.verdict) ??
					(pending ? { status: "running", label: "Checking" } : undefined)
				}
			/>
			<ItemMeta className="w-14 text-end">
				{formatRelativeTime(event.occurredAt)}
			</ItemMeta>
			<ItemActions className="w-14 justify-end">
				{forgeLink ? (
					<ForgeLinkButton forge={event.forge} link={forgeLink} />
				) : null}
			</ItemActions>
		</Item>
	);
}

function EntryOutcome({
	outcome,
}: {
	outcome: { status: StatusValue; label: string } | undefined;
}) {
	return (
		<span
			className={statusVariants({ size: "sm", status: outcome?.status })}
			title={outcome?.label}
		>
			{outcome ? (
				<StatusMark label={outcome.label} status={outcome.status} />
			) : null}
		</span>
	);
}
