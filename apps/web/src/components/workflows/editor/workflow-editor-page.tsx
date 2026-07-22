import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { WorkflowEditor } from "#/components/workflows/editor/workflow-editor";
import {
	EditorFrameSkeleton,
	PAGE_FRAME,
} from "#/components/workflows/editor/workflow-editor-page-skeleton";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import {
	renameRepoWorkflow,
	saveRepoWorkflow,
	setRepoWorkflowEnabled,
	testDeliveryConnection,
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
				onTestConnection={(url, kind) =>
					testDeliveryConnection({ data: { org, repoId, url, kind } })
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
