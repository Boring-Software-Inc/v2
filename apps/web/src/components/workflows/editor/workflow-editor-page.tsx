import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { WorkflowEditor } from "#/components/workflows/editor/workflow-editor";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import {
	renameRepoWorkflow,
	saveRepoWorkflow,
	setRepoWorkflowEnabled,
} from "#/lib/workflows.functions";
import {
	workflowDetailQueryOptions,
	workflowsQueryKeys,
} from "#/lib/workflows.query";

/**
 * Full-screen workflow editor at /$org/$repo/workflows/$workflowId — a slim
 * header bar over a React Flow canvas that fills the rest. Members get a
 * read-only canvas; admins get the full editor.
 */

const routeApi = getRouteApi("/$org/$repo/workflows/$workflowId");

// full-bleed under the topbar: viewport minus the shell's chrome.
const PAGE_FRAME = "flex h-[calc(100dvh-8rem)] w-full flex-col";

export function WorkflowEditorPage() {
	const { org, repo, workflowId } = routeApi.useParams();
	const queryClient = useQueryClient();
	const { data: repoCtx } = useQuery(orgRepoQueryOptions(org, repo));
	const { data: orgCtx } = useQuery(orgContextQueryOptions(org));
	const repoId = repoCtx?.id ?? "";
	const { data: workflow, isPending } = useQuery(
		workflowDetailQueryOptions(org, repoId, workflowId),
	);

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: workflowsQueryKeys.detail(org, repoId, workflowId),
		});
		queryClient.invalidateQueries({
			queryKey: workflowsQueryKeys.list(org, repoId),
		});
	};

	const save = useMutation({
		mutationFn: saveRepoWorkflow,
		onSettled: invalidate,
	});
	const rename = useMutation({
		mutationFn: renameRepoWorkflow,
		onSettled: invalidate,
	});
	const setEnabled = useMutation({
		mutationFn: setRepoWorkflowEnabled,
		onSettled: invalidate,
	});

	// default read-only until the role resolves — never a flash of edit chrome
	// a member shouldn't have.
	const readOnly = orgCtx?.role !== "admin";

	let body: React.ReactNode;
	if (repoId === "" || isPending) {
		body = <EditorFrameSkeleton />;
	} else if (!workflow) {
		body = (
			<div className="grid flex-1 place-items-center">
				<div className="text-center">
					<p className="text-muted-foreground text-sm">workflow not found.</p>
					<Link
						className="mt-2 inline-block text-brand text-xs transition-colors hover:underline"
						params={{ org, repo }}
						to="/$org/$repo/workflows"
					>
						← back to workflows
					</Link>
				</div>
			</div>
		);
	} else {
		body = (
			<WorkflowEditor
				definition={workflow.definition}
				enabled={workflow.enabled}
				key={workflow.id}
				name={workflow.name}
				onRename={(name) =>
					rename.mutateAsync({ data: { org, repoId, workflowId, name } })
				}
				onSave={(definition) =>
					save.mutateAsync({ data: { org, repoId, workflowId, definition } })
				}
				onSetEnabled={(enabled) =>
					setEnabled.mutateAsync({
						data: { org, repoId, workflowId, enabled },
					})
				}
				org={org}
				readOnly={readOnly}
				repo={repo}
				saving={save.isPending}
				toggling={setEnabled.isPending}
			/>
		);
	}

	return (
		<DashboardLayout counts={{}}>
			<div className={PAGE_FRAME}>{body}</div>
		</DashboardLayout>
	);
}

export function WorkflowEditorPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className={PAGE_FRAME}>
				<EditorFrameSkeleton />
			</div>
		</DashboardLayout>
	);
}

function EditorFrameSkeleton() {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
				<div className="h-4 w-20 animate-pulse rounded-md bg-surface-1" />
				<div className="h-5 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="ml-auto h-6 w-24 animate-pulse rounded-md bg-surface-1" />
			</div>
			<div className="relative min-h-0 flex-1">
				<div className="absolute top-3 bottom-3 left-3 w-60 animate-pulse rounded-lg bg-surface-1" />
			</div>
		</div>
	);
}
