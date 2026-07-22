import { Queue01Icon } from "@hugeicons/core-free-icons";
import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EmptyState } from "#/components/common/empty-state";
import { toast } from "#/components/ui/toast";
import { formatRelativeTime } from "#/lib/format-relative-time";
import {
	decideModeration,
	listModerationQueue,
} from "#/lib/moderation-queue.functions";

/**
 * The REAL moderation queue (§6): paused runs from `moderation_items`, with
 * approve/deny that resumes the run and a deep-link to its run page. The home
 * page (`/`) is the one queue surface; this is its list body (no shell/header).
 */

export const moderationQueueKeys = {
	all: ["moderation-queue"] as const,
	list: (org: string, repo: string) =>
		[...moderationQueueKeys.all, org, repo, "list"] as const,
};

export const moderationQueueOptions = (org: string, repo: string) =>
	queryOptions({
		queryKey: moderationQueueKeys.list(org, repo),
		queryFn: ({ signal }) =>
			listModerationQueue({ data: { org, repo }, signal }),
		staleTime: 5_000,
	});

export function ModerationQueue({
	org,
	repo,
	title,
}: {
	/** Org slug from the URL. */
	org: string;
	/** Repo NAME from the URL. */
	repo: string;
	title?: ReactNode;
}) {
	const queryClient = useQueryClient();
	const { data: items } = useQuery(moderationQueueOptions(org, repo));
	const decide = useMutation({
		mutationFn: decideModeration,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: moderationQueueKeys.list(org, repo),
			}),
	});

	return (
		<div className="flex flex-col gap-2">
			{title}
			{items && items.length === 0 ? (
				<EmptyState
					description="blocked changes that need a maintainer's decision land here. approve or deny and the run resumes."
					icon={Queue01Icon}
					title="nothing awaiting moderation"
				/>
			) : (
				items?.map((item) => (
					<div
						className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
						key={item.id}
					>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2 truncate text-sm">
								<span className="truncate">
									<span className="font-medium">
										{item.actorLogin ?? "unknown"}
									</span>{" "}
									<span className="text-muted-foreground">on</span>{" "}
									{item.repoFullName}
									{item.subjectNumber ? ` #${item.subjectNumber}` : ""}
								</span>
								{/* run:degraded = the fail-closed floor, not a workflow node —
								    say so (VERIFICATION-QUEUE #11). */}
								{item.nodeId === "run:degraded" ? (
									<span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 text-xs dark:text-amber-400">
										evaluation degraded
									</span>
								) : null}
							</div>
							<div className="text-muted-foreground text-xs">
								{formatRelativeTime(item.createdAt)} ·{" "}
								<Link
									className="underline underline-offset-2 hover:text-foreground"
									params={{ runId: item.runId }}
									to="/runs/$runId"
								>
									view run
								</Link>
							</div>
						</div>
						<button
							className="rounded-md bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-600 text-xs transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
							disabled={decide.isPending}
							onClick={() =>
								decide.mutate(
									{ data: { org, repo, itemId: item.id, decision: "approve" } },
									{ onSuccess: () => toast("approved — run resuming") },
								)
							}
							type="button"
						>
							approve
						</button>
						<button
							className="rounded-md bg-red-500/10 px-3 py-1.5 font-medium text-red-600 text-xs transition-colors hover:bg-red-500/20 dark:text-red-400"
							disabled={decide.isPending}
							onClick={() =>
								decide.mutate(
									{ data: { org, repo, itemId: item.id, decision: "deny" } },
									{ onSuccess: () => toast("denied — run resuming") },
								)
							}
							type="button"
						>
							deny
						</button>
					</div>
				))
			)}
		</div>
	);
}
