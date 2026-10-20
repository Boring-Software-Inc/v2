import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ArrowLeft, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { WorkflowEditor } from "#/components/workflows/editor/workflow-editor";
import {
	EditorFrameSkeleton,
	PAGE_FRAME,
} from "#/components/workflows/editor/workflow-editor-page-skeleton";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import { ruleConfigsQueryOptions } from "#/lib/rules.query";
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
	const { data: ruleViews } = useQuery(ruleConfigsQueryOptions(org, repoId));
	const customRules = (ruleViews ?? [])
		.filter((view) => view.source === "custom")
		.map((view) => ({
			ref: `${view.ruleId}@${view.version}`,
			name: view.name,
			description: view.sentence ?? view.blurb,
		}));

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

	const loading = repoId === "" || isPending;
	let body: React.ReactNode = null;
	if (!(loading || workflow)) {
		body = (
			<div className="grid flex-1 place-items-center p-4">
				<Empty reason="no-results">
					<EmptyHeader>
						<EmptyTitle>Workflow not found</EmptyTitle>
					</EmptyHeader>
					<EmptyContent>
						<Button
							nativeButton={false}
							render={
								<Link params={{ org, repo }} to="/$org/$repo/workflows" />
							}
							size="sm"
							variant="secondary"
						>
							<Icon icon={ArrowLeft} />
							Back to workflows
						</Button>
					</EmptyContent>
				</Empty>
			</div>
		);
	} else if (!loading && workflow) {
		body = (
			<WorkflowEditor
				customRules={customRules}
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
			<div className={PAGE_FRAME}>
				<SkeletonSwap
					className="flex min-h-0 flex-1 flex-col"
					fallback={<EditorFrameSkeleton />}
					label="Loading workflow"
					loading={loading}
				>
					{body}
				</SkeletonSwap>
			</div>
		</DashboardLayout>
	);
}
