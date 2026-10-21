import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EntityCard } from "#/components/common/entity-card";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import {
	Blocked,
	ChangeRequest,
	Check,
	Comment,
	Icon,
} from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
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
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { toast } from "#/components/glaze/ui/toast";
import { MascotArt } from "#/components/mascot/mascot-art";
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
	title: ReactNode;
}) {
	const queryClient = useQueryClient();
	const { data: items } = useQuery(moderationQueueOptions(org, repo));
	const decide = useMutation({
		mutationFn: decideModeration,
		onError: () =>
			toast.fail("Tripwire could not save your decision", {
				description: "The change request is still waiting. Try again.",
			}),
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: moderationQueueKeys.list(org, repo),
			}),
	});

	if (items && items.length === 0) {
		return (
			<Empty art={<MascotArt mood="moderation-queue-empty" />}>
				<EmptyHeader>
					<EmptyTitle>Nothing to decide</EmptyTitle>
					<EmptyDescription>
						When a rule sends a change request to review, it waits here for you
						to approve or block it.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						nativeButton={false}
						render={<Link params={{ org, repo }} to="/$org/$repo/activity" />}
						size="sm"
						variant="secondary"
					>
						View activity
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<EntityCard
			flush
			footerMeta="Approve passes the check. Reject blocks the change request."
			title={title}
		>
			<ItemGroup aria-label="Sent to review" variant="plain">
				{items?.map((item) => {
					const number = item.subjectNumber ? `#${item.subjectNumber}` : null;
					const subject = number
						? `${number} in ${item.repoFullName}`
						: item.repoFullName;
					const comment = item.eventKind === "comment.created";
					return (
						<Item key={item.id}>
							<ItemMedia variant="icon">
								<Icon icon={comment ? Comment : ChangeRequest} />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>
									<ItemRouterLink
										params={{ runId: item.runId }}
										to="/runs/$runId"
									>
										<MetaRow>
											{number ? <span>{number}</span> : null}
											<span>
												{item.title ?? (comment ? "Comment" : "Change request")}
											</span>
										</MetaRow>
									</ItemRouterLink>
									{item.nodeId === "run:degraded" ? (
										<Badge variant="warn">Check incomplete</Badge>
									) : null}
								</ItemTitle>
								<ItemDescription>
									<MetaRow>
										<span>{item.actorLogin ?? "Unknown contributor"}</span>
										<span>{formatRelativeTime(item.createdAt)}</span>
										{item.reason ? <span>{item.reason}</span> : null}
									</MetaRow>
								</ItemDescription>
							</ItemContent>
							<ItemActions className="me-0 gap-2">
								<Button
									aria-label={`Reject ${subject}`}
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
													toast(
														`Blocked ${subject}. Tripwire marked its check as blocked.`,
													),
											},
										)
									}
									size="sm"
									variant="destructive-wash"
								>
									<Icon icon={Blocked} />
									Reject
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
													toast.success(
														`Approved ${subject}. Tripwire marked its check as passed.`,
													),
											},
										)
									}
									size="sm"
									variant="confirm-wash"
								>
									<Icon icon={Check} />
									Approve
								</Button>
							</ItemActions>
						</Item>
					);
				})}
			</ItemGroup>
		</EntityCard>
	);
}
