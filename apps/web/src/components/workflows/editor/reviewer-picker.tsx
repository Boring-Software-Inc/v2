import type {
	Forge,
	RepoReviewer,
	ReviewerRef,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	requestReviewTargetsSchema,
	reviewerJson,
	sameReviewer,
} from "@tripwire/contracts";
import { createContext, useContext } from "react";
import { Icon, Retry, Warning } from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Button } from "#/design-system/ui/button";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue,
	useComboboxAnchor,
} from "#/design-system/ui/combobox";
import { Field, FieldLabel } from "#/design-system/ui/field";
import { Status } from "#/design-system/ui/status";
import { SupportingText } from "#/design-system/ui/typography";
import { useSyncedList } from "#/hooks/use-synced-list";
import { refreshRepoReviewers } from "#/lib/reviewers.functions";
import { repoReviewersQueryOptions } from "#/lib/reviewers.query";

export const ReviewerScopeContext = createContext<{
	org: string;
	repoId: string;
	forge?: Forge;
} | null>(null);

type PickedReviewer = ReviewerRef & {
	avatarUrl: string;
	stale: boolean;
};

function picked(reviewer: RepoReviewer): PickedReviewer {
	return {
		...reviewer,
		stale: false,
	};
}

export interface ReviewerPickerProps {
	node: Extract<WorkflowNode, { type: "action" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}

export function ReviewerPicker({
	node,
	readOnly,
	onUpdate,
}: ReviewerPickerProps) {
	const scope = useContext(ReviewerScopeContext);
	const org = scope?.org ?? "";
	const repoId = scope?.repoId ?? "";
	const gitCafe = scope?.forge === "gitcafe";
	const anchor = useComboboxAnchor();
	const { data, loading, syncing, refresh } = useSyncedList(
		repoReviewersQueryOptions(org, repoId),
		() => refreshRepoReviewers({ data: { org, repoId } }),
	);

	const synced = (data?.reviewers ?? []).map(picked);
	const known = data?.syncedAt != null;
	const parsed = requestReviewTargetsSchema.safeParse(node.params ?? {});
	const chosen = (parsed.success ? parsed.data.reviewers : []).map(
		(reviewer): PickedReviewer =>
			synced.find((entry) => sameReviewer(entry, reviewer)) ?? {
				...reviewer,
				avatarUrl: "",
				stale: known && !gitCafe,
			},
	);
	const choose = (next: PickedReviewer[]) =>
		onUpdate({
			...node,
			params: {
				...node.params,
				reviewers: reviewerJson(next),
			},
		});

	const refreshButton = (
		<Button
			data-layout-role="workflow-reviewers-refresh"
			disabled={readOnly || repoId === ""}
			onClick={refresh}
			pending={syncing}
			pendingLabel="Refreshing"
			size="sm"
			variant="ghost"
		>
			<Icon icon={Retry} />
			Refresh
		</Button>
	);

	if (synced.length === 0 && chosen.length === 0) {
		if (loading) {
			return (
				<div data-field="reviewers">
					<Status size="sm" status="running">
						Loading reviewers
					</Status>
				</div>
			);
		}
		return (
			<div data-layout-role="workflow-reviewers" data-field="reviewers">
				<SupportingText>
					{gitCafe
						? "Open a pull request on GitCafe, then refresh to load reviewers."
						: "No reviewers found"}
				</SupportingText>
				{refreshButton}
			</div>
		);
	}

	return (
		<div data-layout-role="workflow-reviewers">
			{gitCafe && (
				<SupportingText>
					Suggestions come from open pull requests. GitCafe checks access again
					when requesting review.
				</SupportingText>
			)}
			<Field data-field="reviewers">
				<FieldLabel>Reviewers</FieldLabel>
				<Combobox<PickedReviewer, true>
					disabled={readOnly}
					isItemEqualToValue={sameReviewer}
					itemToStringLabel={(reviewer) => reviewer.login}
					items={synced}
					multiple
					onValueChange={choose}
					value={chosen}
				>
					<ComboboxChips ref={anchor}>
						<ComboboxValue>
							{(selected: PickedReviewer[]) => (
								<>
									{selected.map((reviewer) => (
										<ComboboxChip key={reviewer.id ?? reviewer.login}>
											{reviewer.stale ? (
												<span data-layout-role="workflow-reviewer-stale">
													<Icon icon={Warning} />
													{reviewer.login}
													<span className="sr-only">
														, can no longer review this repo
													</span>
												</span>
											) : (
												reviewer.login
											)}
										</ComboboxChip>
									))}
									<ComboboxChipsInput
										placeholder={selected.length > 0 ? "" : "Search people"}
									/>
								</>
							)}
						</ComboboxValue>
					</ComboboxChips>
					<ComboboxContent anchor={anchor}>
						<ComboboxEmpty>
							{synced.length > 0 ? "No one matches" : "No reviewers found"}
						</ComboboxEmpty>
						<ComboboxList>
							{(reviewer: PickedReviewer) => (
								<ComboboxItem
									key={reviewer.id ?? reviewer.login}
									value={reviewer}
								>
									<span data-layout-role="workflow-reviewer-option">
										<Avatar
											decorative
											name={reviewer.login}
											size="sm"
											src={reviewer.avatarUrl}
										/>
										<span className="truncate">{reviewer.login}</span>
									</span>
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</Field>
			{refreshButton}
		</div>
	);
}
