import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { liveNodeTouches, workingAgents } from "@tripwire/contracts";
import { AgentPresence } from "#/components/agent/agent-presence";
import { ArrowLeft, Icon } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import { DraftActions } from "#/components/workflows/draft-actions";
import { AgentWorkContext } from "#/components/workflows/editor/agent-work-context";
import { WorkflowEditor } from "#/components/workflows/editor/workflow-editor";
import {
	EditorFrameSkeleton,
	PAGE_FRAME,
} from "#/components/workflows/editor/workflow-editor-page-skeleton";
import { useAgentMotion } from "#/hooks/use-agent-motion";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { useWorkClock } from "#/hooks/use-work-clock";
import { shownDefinition } from "#/lib/live-work";
import { useLiveWork } from "#/lib/live-work.query";
import { orgRepoQueryOptions } from "#/lib/org.query";
import { ruleConfigsQueryOptions } from "#/lib/rules.query";
import { aiCreditsOf } from "#/lib/workflow-editor";
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
	const view = routeApi.useSearch({ select: (search) => search.view });
	const navigate = routeApi.useNavigate();
	const queryClient = useQueryClient();
	const { data: repoCtx } = useQuery(orgRepoQueryOptions(org, repo));
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

	const canManage = useOrgPermission(org, "workflows:manage");
	useLiveWork(org, repoId);
	const motion = useAgentMotion();
	const work = workflow?.work ?? null;
	const now = useWorkClock(work);
	const agents = workingAgents(work, now);
	const touches = liveNodeTouches(work, now);
	const draft = work?.draft?.status === "open" ? work.draft : null;
	const draftId = workflow?.draftId ?? null;
	const readOnly = !canManage || draftId !== null;

	const loading = repoId === "" || isPending;
	let body: React.ReactNode = null;
	if (!(loading || workflow)) {
		body = (
			<div className="grid flex-1 place-items-center p-4">
				<Empty
					art={<MascotArt mood="workflow-not-found" />}
					reason="no-results"
				>
					<EmptyHeader>
						<EmptyTitle>Workflow not found</EmptyTitle>
						<EmptyDescription>
							Someone may have deleted it, or the link is out of date.
						</EmptyDescription>
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
			<AgentWorkContext.Provider value={{ touches, motion }}>
				<WorkflowEditor
					aiCredits={aiCreditsOf(ruleViews)}
					customRules={customRules}
					definition={shownDefinition(workflow)}
					enabled={workflow.enabled}
					headerActions={
						draftId && canManage ? (
							<DraftActions
								draftId={draftId}
								name={workflow.name}
								onDiscarded={() =>
									navigate({
										to: "/$org/$repo/workflows",
										params: { org, repo },
									})
								}
								onSaved={(savedId) =>
									navigate({
										to: "/$org/$repo/workflows/$workflowId",
										params: { org, repo, workflowId: savedId },
									})
								}
								org={org}
								replacesLive={workflow.enabled}
								repoId={repoId}
							/>
						) : undefined
					}
					headerLeading={
						<>
							{draftId ? <Badge variant="outline">Draft</Badge> : null}
							<AgentPresence
								agents={agents}
								className="max-md:hidden"
								motion={motion}
							/>
						</>
					}
					key={`${workflow.id}:${draftId ?? "saved"}`}
					live={
						draftId
							? {
									revision: draft?.revision ?? 0,
									change: draft?.lastChange ?? null,
									changedAt: draft?.updatedAt ?? null,
									motion,
								}
							: undefined
					}
					lastTicks={workflow.lastTicks}
					name={workflow.name}
					onRename={(name) =>
						rename.mutateAsync({ data: { org, repoId, workflowId, name } })
					}
					onViewChange={(next) =>
						navigate({
							search: (previous) => ({ ...previous, view: next }),
							replace: true,
						})
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
					repoId={repoId}
					saving={save.isPending}
					toggling={setEnabled.isPending}
					view={view}
				/>
			</AgentWorkContext.Provider>
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
