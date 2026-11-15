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
import { Avatar } from "@tripwire/ui/avatar";
import { Button } from "@tripwire/ui/button";
import { Combobox } from "@tripwire/ui/combobox";
import { Field, FieldLabel } from "@tripwire/ui/field";
import { Icon, Retry } from "@tripwire/ui/icon";
import { Status } from "@tripwire/ui/status";
import { SupportingText } from "@tripwire/ui/typography";
import { createContext, useContext } from "react";
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
			onAction={refresh}
			pending={syncing}
			pendingLabel="Refreshing"
			size="small"
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
					<Status size="small" status="running">
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
				<Combobox<PickedReviewer>
					ariaLabel="Reviewers"
					disabled={readOnly}
					emptyLabel={
						synced.length > 0 ? "No one matches" : "No reviewers found"
					}
					isItemEqualToValue={sameReviewer}
					itemToLabel={(reviewer) =>
						reviewer.stale
							? `${reviewer.login}, can no longer review this repo`
							: reviewer.login
					}
					itemToValue={(reviewer) => String(reviewer.id ?? reviewer.login)}
					multiple
					onValueChange={choose}
					options={synced.map((reviewer) => ({
						icon: (
							<Avatar
								decorative
								name={reviewer.login}
								size="sm"
								src={reviewer.avatarUrl}
							/>
						),
						label: reviewer.login,
						value: reviewer,
					}))}
					placeholder="Search people"
					value={chosen}
					valueTone={(reviewer) => (reviewer.stale ? "warning" : "default")}
				/>
			</Field>
			{refreshButton}
		</div>
	);
}
