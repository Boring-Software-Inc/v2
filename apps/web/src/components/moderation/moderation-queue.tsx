import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EntityCard } from "#/components/common/entity-card";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { ScrollList } from "#/components/common/scroll-list";
import { MascotArt } from "#/components/mascot/mascot-art";
import { isCommentItem } from "#/components/moderation/moderation-collection";
import { ZonedTime } from "#/components/timezones/zoned-time";
import {
	Blocked,
	ChangeRequest,
	Check,
	Comment,
	Icon,
} from "#/design-system/icon";
import { Badge } from "#/design-system/ui/badge";
import { Button } from "#/design-system/ui/button";
import {
	Dialog,
	DialogAction,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/design-system/ui/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/design-system/ui/item";
import { toast } from "#/design-system/ui/toast";
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
		<Empty art={<MascotArt mood="moderation-queue-empty" />}>
			<EmptyHeader>
				<EmptyTitle>Nothing to decide</EmptyTitle>
				<EmptyDescription>
					Contributions that need human review wait here for you to approve or
					block.
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
			toast.fail("Tripwire could not save your decision", {
				description: "The change request is still waiting. Try again.",
			}),
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
								<ItemMedia variant="icon">
									<Icon icon={comment || issue ? Comment : ChangeRequest} />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>
										<ItemRouterLink
											params={{ runId: item.runId }}
											search={{ from: "review" }}
											to="/runs/$runId"
										>
											<MetaRow>
												{number ? <span>{number}</span> : null}
												<span>{item.title ?? subjectLabel}</span>
											</MetaRow>
										</ItemRouterLink>
										{item.nodeId === "run:degraded" ? (
											<Badge variant="warn">Check incomplete</Badge>
										) : null}
									</ItemTitle>
									<ItemDescription>
										<MetaRow wrap>
											<span>{item.actorLogin ?? "Unknown contributor"}</span>
											<ZonedTime at={item.createdAt} format="short" />
											{item.reason ? <span>{item.reason}</span> : null}
										</MetaRow>
									</ItemDescription>
								</ItemContent>
								<ItemActions className="me-0 gap-2">
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
												{ onSuccess: () => toast(`Blocked ${name}.`) },
											)
										}
										subject={subject}
									/>
									<Button
										aria-label={`Approve ${subject}`}
										disabled={decide.isPending || !canDecide}
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
															`Approved ${name}. Tripwire continues the workflow.`,
														),
												},
											)
										}
										size="sm"
										variant="secondary"
									>
										<Icon className="text-ok" icon={Check} />
										Approve
									</Button>
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
	return (
		<Dialog role="alertdialog">
			<DialogTrigger
				render={
					<Button
						aria-label={`Block ${subject}`}
						disabled={disabled}
						size="sm"
						variant="secondary"
					/>
				}
			>
				<Icon className="text-fail" icon={Blocked} />
				Block
			</DialogTrigger>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Block {name}</DialogTitle>
					<DialogDescription>
						Tripwire will fail its check and request changes on GitHub. The
						change request stays open. Block it?
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					<DialogAction
						onAction={onBlock}
						pendingLabel="Blocking"
						variant="destructive"
					>
						Block
					</DialogAction>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
