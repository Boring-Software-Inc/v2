import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@tripwire/ui/button";
import { notify } from "@tripwire/ui/toast";
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
				notify.show(
					{
						title: result.issues
							.slice(0, 2)
							.map((issue) => issue.message)
							.join(" "),
					},
					"error",
				);
				return;
			}
			notify.show({ title: `Saved ${name}` }, "success");
			onSaved?.(result.workflowId);
		},
		onError: () =>
			notify.show(
				{ title: "Tripwire could not save the draft. Try again." },
				"error",
			),
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
					confirmLabel: "Discard",
					description: replacesLive
						? "The live version keeps running as it is."
						: "This can't be undone.",
					title: "Discard this draft?",
				}}
				onAction={async () => {
					const result = await discard.mutateAsync();
					if (!result.discarded) {
						throw new Error("This draft is already gone.");
					}
					onDiscarded?.();
				}}
				pending={discard.isPending}
				pendingLabel="Discarding"
				size="small"
				variant="destructive"
			>
				Discard
			</Button>
			<Button
				onAction={() => promote.mutate()}
				pending={promote.isPending}
				pendingLabel="Saving"
				size="small"
			>
				{replacesLive ? "Save over live version" : "Save workflow"}
			</Button>
		</>
	);
}
