import { Link } from "@tanstack/react-router";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useState } from "react";
import { VerdictChip } from "#/components/activity/verdict-chip";
import type { ActivityGroup, ActivityItem } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { cn } from "#/lib/utils";

/**
 * A change request as a STACK of cards (§9). One bordered, rounded container:
 * the HEADER carries the surface fill (surface-1); the rows sit on the darker
 * base (card) with NO dividers between them. A long stack shows its FIRST 10
 * entries, then a bottom progressive blur with a "show more (N)" pill that
 * reveals the rest inline (no pagination); expanded, a "show less" collapses it.
 * The verdict chip is a FIXED-WIDTH column so chips line up row to row.
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
	const canTruncate = entries.length > VISIBLE;
	const truncated = canTruncate && !showAll;

	return (
		<div className="overflow-hidden rounded-xl border bg-card">
			<StackHeader group={group} />
			{truncated ? (
				<TruncatedBody entries={entries} onShowMore={() => setShowAll(true)} />
			) : (
				<>
					{entries.map((entry) => (
						<EntryCard entry={entry} key={entry.event.id} />
					))}
					{canTruncate ? (
						<div className="flex justify-center py-3">
							<RevealPill onClick={() => setShowAll(false)}>
								show less
							</RevealPill>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}

/** The floating reveal control — same pill for "show more (N)" and "show less". */
function RevealPill({
	onClick,
	children,
}: {
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			className="pointer-events-auto rounded-full border bg-primary px-3 py-1 font-medium text-background text-xs shadow-sm transition-transform hover:scale-98 hover:bg-primary/90"
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
	);
}

/** The top card: the change request's identity + its CURRENT verdict. Carries
 * the surface fill; the rows below sit on the darker base with no dividers. */
function StackHeader({ group }: { group: ActivityGroup }) {
	return (
		<LinkWrap
			className="flex items-center gap-3 bg-surface-1 px-3.5 py-3 transition-colors hover:bg-surface-2"
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
				<EntryCard entry={entry} key={entry.event.id} />
			))}
			{/* Bottom progressive blur fading the tail of the visible rows, with the
			    reveal pill. The overlay CAPTURES pointer events, so the faded rows
			    behind it don't hover or click — only the pill does. Reveal expands
			    the rest inline (no pagination). */}
			<div className="absolute inset-x-0 bottom-0 h-[121px]">
				<ProgressiveBlur />
				<div className="absolute inset-0 flex items-end justify-center pb-6">
					<RevealPill onClick={onShowMore}>show more ({hidden})</RevealPill>
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

/**
 * The fixed-width verdict column: a chip when there's a verdict, a pulse while
 * evaluating, else an empty reserve — so the time column never sways whether or
 * not a row carries a verdict (the chips line up, no stagger).
 */
function VerdictSlot({
	verdict,
	pending = false,
}: {
	verdict: string | null;
	pending?: boolean;
}) {
	if (verdict) {
		return <VerdictChip verdict={verdict} />;
	}
	return (
		<span className="flex w-[60px] shrink-0 items-center justify-center">
			{pending ? (
				<span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
			) : null}
		</span>
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
			<VerdictSlot pending={pending} verdict={run?.verdict ?? null} />
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
