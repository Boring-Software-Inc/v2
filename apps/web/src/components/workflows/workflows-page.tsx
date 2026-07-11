import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { WorkflowCanvas } from "#/components/workflows/editor/canvas";
import { repoOptionsQueryOptions } from "#/lib/rules.query";
import { MODERATOR } from "#/lib/site-config";
import {
	getWorkflowForRepo,
	saveWorkflowForRepo,
} from "#/lib/workflows.functions";

export const workflowsQueryKeys = {
	all: ["workflows"] as const,
	details: () => [...workflowsQueryKeys.all, "detail"] as const,
	detail: (repoId: string | null) =>
		[...workflowsQueryKeys.details(), repoId ?? "default"] as const,
};

const workflowQueryOptions = (repoId: string | null) =>
	queryOptions({
		queryKey: workflowsQueryKeys.detail(repoId),
		queryFn: ({ signal }) => getWorkflowForRepo({ data: { repoId }, signal }),
		staleTime: 15_000,
	});

export function WorkflowsPage() {
	const queryClient = useQueryClient();
	const { data: repos } = useQuery(repoOptionsQueryOptions());
	const [selected, setSelected] = useState<string | null>(null);
	const repoId = selected ?? repos?.[0]?.id ?? null;
	const { data: definition } = useQuery(workflowQueryOptions(repoId));

	const save = useMutation({
		mutationFn: saveWorkflowForRepo,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: workflowsQueryKeys.detail(repoId),
			}),
	});

	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="mx-auto flex h-[calc(100dvh-10rem)] w-full max-w-5xl flex-col px-6 py-8">
				<header className="mb-4 flex items-center justify-between gap-4">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">Workflows</h1>
						<p className="text-muted-foreground text-sm">
							the DAG the executor walks — triggers, rules, gates, actions.
						</p>
					</div>
					{repos && repos.length > 0 ? (
						<select
							className="rounded-md border bg-card px-2 py-1.5 text-sm"
							onChange={(e) => setSelected(e.target.value)}
							value={repoId ?? ""}
						>
							{repos.map((repo) => (
								<option key={repo.id} value={repo.id}>
									{repo.fullName}
								</option>
							))}
						</select>
					) : (
						<span className="text-muted-foreground text-xs">
							default workflow (read-only until a repo is installed)
						</span>
					)}
				</header>
				{definition ? (
					<WorkflowCanvas
						definition={definition}
						key={`${repoId}-${definition.id}`}
						onSave={(next) => {
							if (!repoId) {
								toast("install the app on a repo to save workflows");
								return;
							}
							save.mutate(
								{ data: { repoId, definition: next } },
								{
									onSuccess: (result) => {
										if (result && "error" in result) {
											toast(result.error);
										} else {
											toast("workflow saved");
										}
									},
								},
							);
						}}
						saving={save.isPending}
					/>
				) : null}
			</div>
		</DashboardLayout>
	);
}

export function WorkflowsPageSkeleton() {
	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="mx-auto w-full max-w-5xl px-6 py-8">
				<div className="mb-4 h-8 w-48 animate-pulse rounded-md bg-surface-1" />
				<div className="h-[60dvh] animate-pulse rounded-lg bg-surface-1" />
			</div>
		</DashboardLayout>
	);
}
