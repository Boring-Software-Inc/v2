import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "#/design-system/ui/button";
import { toast } from "#/design-system/ui/toast";
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
			<Button
				confirmation={{
					actionLabel: "Discard",
					description: replacesLive
						? "The live version keeps running as it is."
						: "This can't be undone.",
					pendingLabel: "Discarding",
					title: "Discard this draft?",
				}}
				onAction={async () => {
					const result = await discard.mutateAsync();
					if (!result.discarded) {
						throw new Error("This draft is already gone.");
					}
					onDiscarded?.();
				}}
				size="sm"
				variant="destructive"
			>
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
		</>
	);
}
