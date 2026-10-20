import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ItemRouterLink } from "#/components/common/router-links";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { toast } from "#/components/glaze/ui/toast";
import { formatRelativeTime } from "#/lib/format-relative-time";
import {
	decideModeration,
	listModerationQueue,
} from "#/lib/moderation-queue.functions";

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
	org: string;
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
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Nothing awaiting moderation</EmptyTitle>
						<EmptyDescription>
							Blocked changes that need a maintainer's decision land here.
							Approve or deny and the run resumes.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ItemGroup aria-label="Awaiting moderation">
					{items?.map((item) => {
						const subject = `${item.repoFullName}${item.subjectNumber ? ` #${item.subjectNumber}` : ""}`;
						return (
							<Item key={item.id}>
								<ItemContent>
									<ItemTitle>
										<ItemRouterLink
											params={{ runId: item.runId }}
											to="/runs/$runId"
										>
											{item.actorLogin ?? "unknown"}
											{item.subjectNumber ? (
												<>
													{" "}
													<span className="text-text-2">on</span> #
													{item.subjectNumber}
												</>
											) : null}
										</ItemRouterLink>
										{item.nodeId === "run:degraded" ? (
											<Badge variant="warn">Evaluation degraded</Badge>
										) : null}
									</ItemTitle>
									<ItemDescription className="truncate">
										{formatRelativeTime(item.createdAt)} · {item.repoFullName}
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<Button
										aria-label={`Deny ${subject}`}
										disabled={decide.isPending}
										onClick={() =>
											decide.mutate(
												{
													data: {
														org,
														repo,
														itemId: item.id,
														decision: "deny",
													},
												},
												{
													onSuccess: () =>
														toast("Denied. This change is blocked."),
												},
											)
										}
										size="sm"
										variant="ghost"
									>
										Deny
									</Button>
									<Button
										aria-label={`Approve ${subject}`}
										disabled={decide.isPending}
										onClick={() =>
											decide.mutate(
												{
													data: {
														org,
														repo,
														itemId: item.id,
														decision: "approve",
													},
												},
												{
													onSuccess: () =>
														toast.success("Approved. This change can proceed."),
												},
											)
										}
										size="sm"
										variant="secondary"
									>
										Approve
									</Button>
								</ItemActions>
							</Item>
						);
					})}
				</ItemGroup>
			)}
		</div>
	);
}
