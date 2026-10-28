import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { Button } from "#/components/glaze/ui/button";
import { toast } from "#/components/glaze/ui/toast";
import { discardRepoDraft, promoteRepoDraft } from "#/lib/workflows.functions";
import { workflowsQueryKeys } from "#/lib/workflows.query";

export interface DraftActionsProps {
	org: string;
	repoId: string;
	draftId: string;
	name: string;
	replacesLive: boolean;
	onSaved?: (workflowId: string) => void;
	onDiscarded?: () => void;
}

/** Save keeps the draft as a workflow that stays off; Discard drops it. */
export function DraftActions({
	org,
	repoId,
	draftId,
	name,
	replacesLive,
	onSaved,
	onDiscarded,
}: DraftActionsProps) {
	const queryClient = useQueryClient();
	const [discarding, setDiscarding] = useState(false);
	const refresh = () => {
		queryClient.invalidateQueries({
			queryKey: workflowsQueryKeys.list(org, repoId),
		});
		queryClient.invalidateQueries({
			queryKey: [...workflowsQueryKeys.details(), org, repoId],
		});
	};
	const promote = useMutation({
		mutationFn: () => promoteRepoDraft({ data: { org, repoId, draftId } }),
		onSuccess: (result) => {
			if (!result.ok) {
				toast.fail(
					result.issues
						.slice(0, 2)
						.map((issue) => issue.message)
						.join(" "),
				);
				return;
			}
			toast.success(`Saved ${name}`);
			onSaved?.(result.workflowId);
		},
		onError: () => toast.fail("Tripwire could not save the draft. Try again."),
		onSettled: refresh,
	});
	const discard = useMutation({
		mutationFn: () => discardRepoDraft({ data: { org, repoId, draftId } }),
		onSettled: refresh,
	});

	return (
		<>
			<Button onClick={() => setDiscarding(true)} size="sm" variant="secondary">
				Discard
			</Button>
			<Button
				onClick={() => promote.mutate()}
				pending={promote.isPending}
				pendingLabel="Saving"
				size="sm"
			>
				{replacesLive ? "Save over live version" : "Save workflow"}
			</Button>
			<ConfirmDeleteDialog
				actionLabel="Discard"
				description={
					replacesLive
						? "The live version keeps running as it is."
						: "This can't be undone."
				}
				onConfirm={async () => {
					const result = await discard.mutateAsync();
					if (!result.discarded) {
						throw new Error("This draft is already gone.");
					}
					onDiscarded?.();
				}}
				onOpenChange={setDiscarding}
				open={discarding}
				pendingLabel="Discarding"
				title="Discard this draft?"
			/>
		</>
	);
}
