import { Link } from "@tanstack/react-router";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useState } from "react";
import { VerdictChip } from "#/components/activity/verdict-chip";
import type { ActivityGroup, ActivityItem } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { cn } from "#/lib/utils";

/**
 * A change request as a STACK of cards (§9). The container rounds the outer
 * corners and clips; inner cards are divided by a top border with no gaps, so
 * the top card rounds up, the bottom rounds down, and the middle is square. A
 * long stack shows its FIRST 10 entries, then a bottom progressive blur with a
 * "show more (N)" pill that reveals the rest inline (no pagination).
 */

const VISIBLE = 10;

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

function LinkWrap({
	runId,
	url,
	className,
	children,
}: {
	runId: string | null;
	url: string | null;
	className: string;
	children: React.ReactNode;
}) {
	if (runId) {
		return (
			<Link className={className} params={{ runId }} to="/runs/$runId">
				{children}
			</Link>
		);
	}
	if (url) {
		return (
			<a className={className} href={url} rel="noreferrer" target="_blank">
				{children}
			</a>
		);
	}
	return <div className={className}>{children}</div>;
}

export function ActivityStack({ group }: { group: ActivityGroup }) {
	const [showAll, setShowAll] = useState(false);
	const entries = group.timeline;
	const truncated = entries.length > VISIBLE && !showAll;

	return (
		<div className="overflow-hidden rounded-xl border bg-card">
			<StackHeader group={group} />
			{truncated ? (
				<TruncatedBody entries={entries} onShowMore={() => setShowAll(true)} />
			) : (
				entries.map((entry) => (
					<div className="border-t" key={entry.event.id}>
						<EntryCard entry={entry} />
					</div>
				))
			)}
		</div>
	);
}

/** The top card: the change request's identity + its CURRENT verdict. */
function StackHeader({ group }: { group: ActivityGroup }) {
	return (
		<LinkWrap
			className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface-1"
			runId={group.currentRunId}
			url={group.url}
		>
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
			<span className="w-14 shrink-0 text-right text-muted-foreground text-xs">
				{formatRelativeTime(group.latestActivityAt)}
			</span>
		</LinkWrap>
	);
}

function TruncatedBody({
	entries,
	onShowMore,
}: {
	entries: ActivityItem[];
	onShowMore: () => void;
}) {
	const visible = entries.slice(0, VISIBLE);
	const hidden = entries.length - visible.length;

	return (
		<div className="relative">
			{visible.map((entry) => (
				<div className="border-t" key={entry.event.id}>
					<EntryCard entry={entry} />
				</div>
			))}
			{/* Bottom progressive blur fading the tail of the visible rows, with the
			    reveal pill — the rest expand inline, no pagination. */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-[121px]">
				<ProgressiveBlur />
				<div className="absolute inset-0 flex items-end justify-center pb-6">
					<button
						className="pointer-events-auto rounded-full border bg-card px-3 py-1 font-medium text-muted-foreground text-xs shadow-sm transition-colors hover:text-foreground"
						onClick={onShowMore}
						type="button"
					>
						show more ({hidden})
					</button>
				</div>
			</div>
		</div>
	);
}

/** Stacked backdrop-blur layers, each masked lower, so the blur intensifies
 * toward the bottom of the visible rows. */
function ProgressiveBlur() {
	return (
		<>
			{[1, 2, 4, 8].map((radius, i) => (
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0"
					key={radius}
					style={{
						backdropFilter: `blur(${radius}px)`,
						WebkitBackdropFilter: `blur(${radius}px)`,
						maskImage: `linear-gradient(to bottom, transparent ${i * 22}%, black ${i * 22 + 22}%)`,
						WebkitMaskImage: `linear-gradient(to bottom, transparent ${i * 22}%, black ${i * 22 + 22}%)`,
					}}
				/>
			))}
		</>
	);
}

function EntryCard({ entry }: { entry: ActivityItem }) {
	const { event, run, pending } = entry;
	const ours = isTripwireComment(event);
	// A decision (a run) stands full; context (no run: exempt, push, comment)
	// dims so it never competes with the verdicts (§9).
	const dim = !run && !pending;
	const inner = (
		<div
			className={cn(
				"flex items-center gap-3 px-3.5 py-2.5",
				dim && "opacity-55",
			)}
		>
			<span
				className={cn(
					"block size-1.5 shrink-0 rounded-full",
					run?.verdict === "block"
						? "bg-red-500"
						: run?.verdict === "pass"
							? "bg-emerald-500"
							: run?.verdict === "needs_review"
								? "bg-amber-500"
								: "bg-muted-foreground/40",
				)}
			/>
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

	return (
		<LinkWrap
			className="block transition-colors hover:bg-surface-1"
			runId={run?.runId ?? null}
			url={entryUrl(event)}
		>
			{inner}
		</LinkWrap>
	);
}
