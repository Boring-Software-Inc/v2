import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useState } from "react";
import { VerdictChip } from "#/components/activity/verdict-chip";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { toast } from "#/components/ui/toast";
import type {
	ActivityFeedData,
	ActivityGroup,
	ActivityItem,
} from "#/lib/activity.functions";
import {
	getRerunPreview,
	rerunChangeRequest,
	rerunRulesLine,
} from "#/lib/activity.functions";
import { activityQueryKeys } from "#/lib/activity.query";
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

/** Admin-only re-run wiring: the URL scope the mutation needs. Null ⇒ hidden. */
export interface RerunScope {
	org: string;
	repo: string;
}

export function ActivityStack({
	group,
	rerun = null,
}: {
	group: ActivityGroup;
	rerun?: RerunScope | null;
}) {
	const [showAll, setShowAll] = useState(false);
	const entries = group.timeline;
	const canTruncate = entries.length > VISIBLE;
	const truncated = canTruncate && !showAll;

	return (
		<div className="overflow-hidden rounded-xl border bg-card">
			<StackHeader group={group} rerun={rerun} />
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
 * the surface fill; the rows below sit on the darker base with no dividers.
 * The re-run affordance sits OUTSIDE the LinkWrap (no button-in-link nesting);
 * its confirm step opens a modal so the header stays uncrowded. */
function StackHeader({
	group,
	rerun,
}: {
	group: ActivityGroup;
	rerun: RerunScope | null;
}) {
	const evaluating = group.currentRunId != null && group.currentVerdict == null;
	return (
		<div className="bg-surface-1">
			<div className="flex items-center gap-3 px-3.5 py-3">
				<LinkWrap
					className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 transition-colors hover:bg-surface-2"
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
							{evaluating ? " · re-evaluating" : ""}
						</div>
					</div>
					<span className="w-14 shrink-0 text-right text-muted-foreground text-xs">
						{formatRelativeTime(group.latestActivityAt)}
					</span>
					<VerdictSlot pending={evaluating} verdict={group.currentVerdict} />
				</LinkWrap>
				{rerun ? <RerunControl group={group} scope={rerun} /> : null}
			</div>
		</div>
	);
}

/**
 * Re-run confirm in the Dialog primitive (portaled — the card's
 * overflow-hidden can't clip it). The header keeps only the compact button;
 * the dialog carries the cost copy per the founder requirement — this spends
 * real evaluation and updates the public review surfaces — and the confirm
 * sits in the destructive register.
 */
function RerunControl({
	group,
	scope,
}: {
	group: ActivityGroup;
	scope: RerunScope;
}) {
	const [open, setOpen] = useState(false);
	const [unavailable, setUnavailable] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const preview = useQuery({
		queryKey: ["rerun-preview", scope.org, scope.repo],
		queryFn: () =>
			getRerunPreview({ data: { org: scope.org, repo: scope.repo } }),
		enabled: open,
		staleTime: 15_000,
	});
	const mutation = useMutation({
		mutationFn: rerunChangeRequest,
		onSuccess: (result) => {
			if (result.status === "queued") {
				setOpen(false);
				// Instant feedback: point the group at the pre-materialized run and
				// mark it evaluating until the SSE `run` event lands the verdict.
				queryClient.setQueryData<ActivityFeedData>(
					activityQueryKeys.feed(scope.org, scope.repo),
					(current) =>
						markGroupEvaluating(current, group.subjectNumber, result.runId),
				);
				void queryClient.invalidateQueries({
					queryKey: activityQueryKeys.feed(scope.org, scope.repo),
				});
				toast("re-run queued — this card updates when it lands");
			} else if (result.status === "cooldown") {
				setOpen(false);
				toast(
					`re-run available again in ~${Math.max(1, Math.ceil(result.retryInSeconds / 60))} min`,
				);
			} else if (result.status === "no-workflow") {
				setUnavailable(
					"no enabled rules — nothing to evaluate. enable a rule or workflow first.",
				);
			} else if (result.status === "no-event") {
				setUnavailable(
					"no evaluatable event for this change request — open or update it first.",
				);
			} else {
				setUnavailable("this repo isn't armed — arm it first.");
			}
		},
		onError: () => {
			toast("re-run failed to queue — try again");
		},
	});

	const rulesCopy =
		unavailable ??
		(preview.data
			? `${rerunRulesLine(preview.data.ruleNames)}. this may cost ai review usage. the pr's review comment and check will be updated.`
			: "this runs your current rules again and may cost ai review usage. the pr's review comment and check will be updated.");

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setUnavailable(null);
				}
			}}
			open={open}
		>
			<DialogTrigger
				className="shrink-0 rounded-md bg-red-500/10 px-2.5 py-1 font-medium text-red-600 text-xs transition-colors hover:bg-red-500/20 dark:text-red-400"
				type="button"
			>
				re-run rules
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>re-run rules?</DialogTitle>
					<DialogDescription className="truncate">
						#{group.subjectNumber} {group.title}
					</DialogDescription>
				</DialogHeader>
				<p className="px-5 pb-4 text-muted-foreground text-sm">{rulesCopy}</p>
				<DialogFooter>
					<DialogClose
						className="text-muted-foreground text-xs transition-colors hover:text-foreground"
						type="button"
					>
						cancel
					</DialogClose>
					{unavailable ? null : (
						<button
							className="rounded-md bg-red-500/10 px-3 py-1.5 font-medium text-red-600 text-xs transition-colors hover:bg-red-500/20 dark:text-red-400"
							disabled={mutation.isPending}
							onClick={() =>
								mutation.mutate({
									data: {
										org: scope.org,
										repo: scope.repo,
										number: group.subjectNumber,
									},
								})
							}
							type="button"
						>
							{mutation.isPending ? "queueing…" : "confirm re-run"}
						</button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Optimistic: swap the group's current run to the queued re-run. */
function markGroupEvaluating(
	data: ActivityFeedData | undefined,
	subjectNumber: number,
	runId: string,
): ActivityFeedData {
	const items = data?.items ?? [];
	return {
		items: items.map((item) => {
			if (item.type !== "group" || item.group.subjectNumber !== subjectNumber) {
				return item;
			}
			const group = item.group;
			// Attach the pending run to the latest change-request timeline entry so
			// the pulse shows on the row that carried the previous verdict.
			const crIdx = [...group.timeline]
				.map((t, i) => ({ t, i }))
				.reverse()
				.find(({ t }) => "changeRequest" in t.event)?.i;
			const timeline =
				crIdx == null
					? group.timeline
					: group.timeline.map((entry, i) =>
							i === crIdx
								? {
										...entry,
										run: {
											runId,
											verdict: null,
											status: "queued",
											reason: null,
										},
										pending: true,
									}
								: entry,
						);
			return {
				type: "group" as const,
				group: {
					...group,
					currentRunId: runId,
					currentVerdict: null,
					timeline,
					latestActivityAt: new Date().toISOString(),
				},
			};
		}),
	};
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
			{/* Fog the tail of the visible rows with the shared .fluted-glass class
			    ("fog sensitive log content until revealed") — masked to fade in from
			    the top. The overlay CAPTURES pointer events, so the fogged rows
			    behind it don't hover or click; only the pill does. Reveal expands the
			    rest inline (no pagination). */}
			<div className="absolute inset-x-0 bottom-0 h-[121px]">
				<div
					aria-hidden
					className="fluted-glass absolute inset-0"
					style={{
						maskImage: "linear-gradient(to bottom, transparent, black 66%)",
						WebkitMaskImage:
							"linear-gradient(to bottom, transparent, black 66%)",
					}}
				/>
				<div className="absolute inset-0 flex items-end justify-center pb-6">
					<RevealPill onClick={onShowMore}>show more ({hidden})</RevealPill>
				</div>
			</div>
		</div>
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
				{run?.status === "queued" || run?.status === "running" ? (
					<span className="truncate"> · re-evaluating</span>
				) : run?.reason ? (
					<span className="truncate"> · {run.reason}</span>
				) : null}
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
