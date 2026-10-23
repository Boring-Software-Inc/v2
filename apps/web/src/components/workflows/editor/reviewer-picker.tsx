import type { RepoReviewer, WorkflowNode } from "@tripwire/contracts";
import {
	requestReviewTargetsSchema,
	reviewerJson,
	sameReviewer,
} from "@tripwire/contracts";
import { createContext, useContext } from "react";
import { Icon, Retry, Warning } from "#/components/glaze/icon";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
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
} from "#/components/glaze/ui/combobox";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import { Status } from "#/components/glaze/ui/status";
import { useSyncedList } from "#/hooks/use-synced-list";
import { refreshRepoReviewers } from "#/lib/reviewers.functions";
import { repoReviewersQueryOptions } from "#/lib/reviewers.query";

export const ReviewerScopeContext = createContext<{
	org: string;
	repoId: string;
} | null>(null);

interface PickedReviewer {
	id?: number;
	login: string;
	avatarUrl: string;
	stale: boolean;
}

function picked(reviewer: RepoReviewer): PickedReviewer {
	return {
		id: reviewer.id,
		login: reviewer.login,
		avatarUrl: reviewer.avatarUrl,
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
				id: reviewer.id,
				login: reviewer.login,
				avatarUrl: "",
				stale: known,
			},
	);
	const choose = (next: PickedReviewer[]) =>
		onUpdate({
			...node,
			params: {
				...node.params,
				reviewers: reviewerJson(
					next.map((reviewer) => ({ id: reviewer.id, login: reviewer.login })),
				),
			},
		});

	const refreshButton = (
		<Button
			className="self-start"
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
			<div className="flex flex-col gap-2" data-field="reviewers">
				<p className="type-body-sm text-text-2">No reviewers found</p>
				{refreshButton}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
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
										<ComboboxChip key={reviewer.login}>
											{reviewer.stale ? (
												<span className="inline-flex items-center gap-1 text-warn-text">
													<Icon className="text-warn-text" icon={Warning} />
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
								<ComboboxItem key={reviewer.login} value={reviewer}>
									<span className="flex min-w-0 items-center gap-2">
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
