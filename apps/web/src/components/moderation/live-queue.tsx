import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { formatRelativeTime } from "#/lib/format-relative-time";
import {
	decideModeration,
	listModerationQueue,
} from "#/lib/moderation-queue.functions";
import { MODERATOR } from "#/lib/site-config";

export const moderationQueueKeys = {
	all: ["moderation-queue"] as const,
	list: () => [...moderationQueueKeys.all, "list"] as const,
};

const moderationQueueOptions = () =>
	queryOptions({
		queryKey: moderationQueueKeys.list(),
		queryFn: ({ signal }) => listModerationQueue({ signal }),
		staleTime: 5_000,
	});

export function LiveModerationQueue() {
	const queryClient = useQueryClient();
	const { data: items } = useQuery(moderationQueueOptions());
	const decide = useMutation({
		mutationFn: decideModeration,
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: moderationQueueKeys.list() }),
	});

	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<header className="mb-6">
					<h1 className="font-semibold text-2xl tracking-tight">Moderation</h1>
					<p className="text-muted-foreground text-sm">
						paused runs awaiting a decision — approve resumes, deny walks the
						deny edge.
					</p>
				</header>
				{items && items.length === 0 ? (
					<div className="rounded-lg border border-dashed px-6 py-16 text-center text-muted-foreground text-sm">
						nothing awaiting moderation.
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{items?.map((item) => (
							<div
								className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
								key={item.id}
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">
										<span className="font-medium">
											{item.actorLogin ?? "unknown"}
										</span>{" "}
										<span className="text-muted-foreground">on</span>{" "}
										{item.repoFullName}
										{item.subjectNumber ? ` #${item.subjectNumber}` : ""}
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
											{ data: { itemId: item.id, decision: "approve" } },
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
											{ data: { itemId: item.id, decision: "deny" } },
											{ onSuccess: () => toast("denied — run resuming") },
										)
									}
									type="button"
								>
									deny
								</button>
							</div>
						))}
					</div>
				)}
			</div>
		</DashboardLayout>
	);
}

export function LiveModerationQueueSkeleton() {
	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<div className="mb-6 h-8 w-48 animate-pulse rounded-md bg-surface-1" />
				<div className="flex flex-col gap-2">
					{Array.from({ length: 4 }, (_, i) => `mod-skel-${i}`).map((key) => (
						<div
							className="h-16 animate-pulse rounded-lg bg-surface-1"
							key={key}
						/>
					))}
				</div>
			</div>
		</DashboardLayout>
	);
}
