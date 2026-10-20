import { Link } from "@tanstack/react-router";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useState } from "react";
import { VerdictChip } from "#/components/activity/verdict-chip";
import { ItemRouterLink } from "#/components/common/router-links";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardMeta,
	CardTitle,
} from "#/components/glaze/ui/card";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemLink,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { Status } from "#/components/glaze/ui/status";
import type { ActivityGroup, ActivityItem } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";

const VISIBLE = 10;

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
		<Card>
			<StackHeader group={group} />
			<CardContent flush>
				<ItemGroup
					aria-label={`Timeline of #${group.subjectNumber}`}
					variant="plain"
				>
					{visible.map((entry) => (
						<EntryRow entry={entry} key={entry.event.id} />
					))}
				</ItemGroup>
			</CardContent>
			{canTruncate ? (
				<CardFooter>
					<CardMeta>
						{showAll
							? `${entries.length} events`
							: `${VISIBLE} of ${entries.length} events`}
					</CardMeta>
					<Button
						onClick={() => setShowAll((v) => !v)}
						size="sm"
						variant="secondary"
					>
						{showAll ? "Show fewer events" : `Show ${hidden} more events`}
					</Button>
				</CardFooter>
			) : null}
		</Card>
	);
}

function StackHeader({ group }: { group: ActivityGroup }) {
	const evaluating = group.currentRunId != null && group.currentVerdict == null;
	const title = (
		<>
			#{group.subjectNumber} {group.title}
		</>
	);
	return (
		<CardHeader>
			<CardTitle>
				{group.currentRunId ? (
					<Link
						className="hover:underline"
						params={{ runId: group.currentRunId }}
						to="/runs/$runId"
					>
						{title}
					</Link>
				) : group.url ? (
					<a
						className="hover:underline"
						href={group.url}
						rel="noreferrer"
						target="_blank"
					>
						{title}
					</a>
				) : (
					title
				)}
			</CardTitle>
			<CardDescription className="truncate">
				{group.actor.login} · {group.repoFullName} ·{" "}
				{formatRelativeTime(group.latestActivityAt)}
			</CardDescription>
			<div className="col-start-2 row-span-2 row-start-1 flex items-center">
				{evaluating ? (
					<Status size="sm" status="running">
						Re-evaluating
					</Status>
				) : (
					<VerdictChip verdict={group.currentVerdict} />
				)}
			</div>
		</CardHeader>
	);
}

function EntryRow({ entry }: { entry: ActivityItem }) {
	const { event, run, pending } = entry;
	const ours = isTripwireComment(event);
	const runId = run?.runId ?? null;
	const url = entryUrl(event);
	const reevaluating = run?.status === "queued" || run?.status === "running";
	const text = (
		<>
			{ours ? "tripwire" : event.actor.login}{" "}
			<span className="text-text-2">
				{entryLabel(event)}
				{reevaluating
					? " · re-evaluating"
					: run?.reason
						? ` · ${run.reason}`
						: ""}
			</span>
		</>
	);

	return (
		<Item size="sm">
			<ItemContent>
				<ItemTitle>
					{runId ? (
						<ItemRouterLink params={{ runId }} to="/runs/$runId">
							{text}
						</ItemRouterLink>
					) : url ? (
						<ItemLink href={url} rel="noreferrer" target="_blank">
							{text}
						</ItemLink>
					) : (
						<span>{text}</span>
					)}
					{ours ? <Badge size="sm">Bot</Badge> : null}
				</ItemTitle>
			</ItemContent>
			{run?.verdict ? (
				<VerdictChip verdict={run.verdict} />
			) : pending ? (
				<Status size="sm" status="running">
					Evaluating
				</Status>
			) : null}
			<ItemMeta className="w-14 text-end">
				{formatRelativeTime(event.occurredAt)}
			</ItemMeta>
		</Item>
	);
}
