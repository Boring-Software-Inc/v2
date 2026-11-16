import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { AGENT_CHANGE_SOURCE, AgentBoundary } from "@tripwire/ui/agent-policy";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import { DestructiveDialog } from "@tripwire/ui/dialog";
import { Blocked, Check, Icon } from "@tripwire/ui/icon";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@tripwire/ui/item";
import { notify } from "@tripwire/ui/toast";
import { type ReactNode, useState } from "react";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { EntityCard } from "#/components/common/entity-card";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { ScrollList } from "#/components/common/scroll-list";
import { MascotArt } from "#/components/mascot/mascot-art";
import { isCommentItem } from "#/components/moderation/moderation-collection";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { useOrgPermission } from "#/hooks/use-org-permission";
import {
	decideModeration,
	listModerationQueue,
	type ModerationQueueItem,
} from "#/lib/moderation-queue.functions";
import { trackEvent } from "#/lib/track";

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

export function ModerationQueueEmpty({
	org,
	repo,
}: {
	org: string;
	repo: string;
}) {
	return (
		<EmptyState art={<MascotArt mood="moderation-queue-empty" />}>
			<EmptyStateHeader>
				<EmptyStateTitle>Nothing to decide</EmptyStateTitle>
				<EmptyStateDescription>
					Contributions that need human review wait here for you to approve or
					block.
				</EmptyStateDescription>
			</EmptyStateHeader>
			<EmptyStateContent>
				<Button
					href={`/${org}/${repo}/activity`}
					size="small"
					variant="secondary"
				>
					View activity
				</Button>
			</EmptyStateContent>
		</EmptyState>
	);
}

export function ModerationQueue({
	org,
	repo,
	items,
	title,
}: {
	org: string;
	repo: string;
	items: ModerationQueueItem[];
	title: ReactNode;
}) {
	const queryClient = useQueryClient();
	const canDecide = useOrgPermission(org, "moderation:manage");
	const decide = useMutation({
		mutationFn: decideModeration,
		onSuccess: (_result, variables) =>
			trackEvent("moderation_decided", { decision: variables.data.decision }),
		onError: () =>
			notify.show(
				{
					title: "Tripwire could not save your decision",
					description: "The change request is still waiting. Try again.",
				},
				"error",
			),
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: moderationQueueKeys.list(org, repo),
			}),
	});

	return (
		<EntityCard feedbackName="ModerationQueue" flush title={title}>
			<ScrollList label="Human review">
				<ItemGroup aria-label="Human review" variant="plain">
					{items.map((item) => {
						const number = item.subjectNumber ? `#${item.subjectNumber}` : null;
						const subject = number
							? `${number} in ${item.repoFullName}`
							: item.repoFullName;
						const comment = isCommentItem(item);
						const issue = item.eventKind === "issue.opened";
						const subjectLabel = comment
							? "Comment"
							: issue
								? "Issue"
								: "Change request";
						const name = number ?? `this ${subjectLabel.toLowerCase()}`;
						return (
							<Item key={item.id}>
								<ItemContent>
									<ItemTitle>
										<ItemRouterLink
											params={{ runId: item.runId }}
											search={{ from: "review" }}
											to="/runs/$runId"
										>
											{item.title ?? subjectLabel}
										</ItemRouterLink>
										{number ? (
											<span data-layout-role="moderation-item-number">
												{number}
											</span>
										) : null}
										{item.nodeId === "run:degraded" ? (
											<Badge tone="warning">Check incomplete</Badge>
										) : null}
									</ItemTitle>
									<ItemDescription data-layout-role="moderation-item-description">
										{item.reason ? (
											<span className="line-clamp-2">{item.reason}</span>
										) : null}
										<MetaRow data-layout-role="moderation-item-meta" wrap>
											<span>{item.actorLogin ?? "Unknown contributor"}</span>
											<ZonedTime at={item.createdAt} format="short" />
											<span>{subjectLabel}</span>
										</MetaRow>
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<AgentBoundary visibility="hidden">
										<BlockButton
											disabled={decide.isPending || !canDecide}
											name={name}
											onBlock={() =>
												decide.mutateAsync(
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
															notify.show({ title: `Blocked ${name}.` }),
													},
												)
											}
											subject={subject}
										/>
										<Button
											ariaLabel={`Approve ${subject}`}
											disabled={decide.isPending || !canDecide}
											onAction={({ source }) => {
												if (source === AGENT_CHANGE_SOURCE) return;
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
															notify.show(
																{
																	title: `Approved ${name}. Tripwire continues the workflow.`,
																},
																"success",
															),
													},
												);
											}}
											size="small"
											variant="secondary"
										>
											<span
												className="flex size-4 items-center justify-center rounded-full"
												data-layout-role="approve-glyph"
											>
												<Icon icon={Check} size={12} />
											</span>
											Approve
										</Button>
									</AgentBoundary>
								</ItemActions>
							</Item>
						);
					})}
				</ItemGroup>
			</ScrollList>
		</EntityCard>
	);
}

function BlockButton({
	name,
	subject,
	disabled,
	onBlock,
}: {
	name: string;
	subject: string;
	disabled: boolean;
	onBlock: () => Promise<{ ok: boolean }>;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				ariaLabel={`Block ${subject}`}
				disabled={disabled}
				onAction={({ source }) => {
					if (source !== AGENT_CHANGE_SOURCE) setOpen(true);
				}}
				size="small"
				variant="secondary"
			>
				<Icon icon={Blocked} tone="danger" />
				Block
			</Button>
			<DestructiveDialog
				agentVisibility="hidden"
				confirmLabel="Block"
				description={
					<span data-layout-role="moderation-block-description">
						Tripwire will fail its check and request changes on GitHub. The
						change request stays open. Block it?
					</span>
				}
				onConfirm={({ source }) => {
					if (source !== AGENT_CHANGE_SOURCE) return onBlock();
				}}
				onOpenChange={setOpen}
				open={open}
				pendingLabel="Blocking"
				title={`Block ${name}`}
			/>
		</>
	);
}
