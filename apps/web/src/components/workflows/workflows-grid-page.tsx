import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
	FORGE_BY_ID,
	type Forge,
	forgeEvaluates,
	WORKFLOW_STATE_LABELS,
	WORKFLOW_TEMPLATES,
	type WorkflowState,
	type WorkflowTemplate,
	workingAgents,
} from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import { Button, IconButton } from "@tripwire/ui/button";
import { ButtonGroup, ButtonGroupMenu } from "@tripwire/ui/button-group";
import { Dialog } from "@tripwire/ui/dialog";
import { Field, FieldLabel, Input } from "@tripwire/ui/field";
import { Add, Icon, MoreVertical } from "@tripwire/ui/icon";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@tripwire/ui/item";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { Status, type StatusValue } from "@tripwire/ui/status";
import { Switch } from "@tripwire/ui/switch";
import { notify } from "@tripwire/ui/toast";
import { useMemo, useState } from "react";
import { AgentOutline } from "#/components/agent/agent-outline";
import { AgentPresence } from "#/components/agent/agent-presence";
import { Collection } from "#/components/collection/collection";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { EntityCard } from "#/components/common/entity-card";
import { MetaRow } from "#/components/common/meta-row";
import { CardRouterLink } from "#/components/common/router-links";
import { ShaderDither } from "#/components/dither/shader-dither";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	SaveQueueProvider,
	type SaveQueueValues,
	UnsavedChangesBar,
	useSaveQueueField,
} from "#/components/save-queue";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { DraftActions } from "#/components/workflows/draft-actions";
import {
	humanizeTriggerKind,
	WORKFLOWS_COLLECTION,
} from "#/components/workflows/workflows-collection";
import { GridSkeleton } from "#/components/workflows/workflows-grid-page-skeleton";
import { type AgentMotion, useAgentMotion } from "#/hooks/use-agent-motion";
import { useCollection } from "#/hooks/use-collection";
import { useMediaQuery } from "#/hooks/use-media-query";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { useWorkClock } from "#/hooks/use-work-clock";
import { useLiveWork } from "#/lib/live-work.query";
import { orgRepoQueryOptions } from "#/lib/org.query";
import { trackEvent } from "#/lib/track";
import type { WorkflowCard } from "#/lib/workflows.functions";
import {
	createRepoWorkflow,
	deleteRepoWorkflow,
	duplicateRepoWorkflow,
	renameRepoWorkflow,
	setRepoWorkflowEnabled,
} from "#/lib/workflows.functions";
import {
	workflowsListQueryOptions,
	workflowsQueryKeys,
} from "#/lib/workflows.query";
import "./workflows-grid-page.css";

const STATE_STATUS = {
	on: "ok",
	off: "idle",
	"cant-run": "warn",
	"needs-fixes": "warn",
	"cant-turn-on": "idle",
} as const satisfies Record<WorkflowState, StatusValue>;

const route = getRouteApi("/$org/$repo/workflows/");

/** Queue key for a workflow's enabled flag. */
const enabledKey = (workflowId: string) => `${workflowId}:enabled`;

/**
 * The workflows list (§grid): every workflow this repo runs, one row each.
 * Members see it read-only (cosmetic; the server enforces). Templates are
 * face-up only in the empty state; once real workflows exist they demote
 * into the create menu.
 */
export function WorkflowsGridPage() {
	const { org, repo: repoName } = route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const repoId = repo?.id ?? "";
	const workflowsQuery = useQuery(workflowsListQueryOptions(org, repoId));
	const workflows = workflowsQuery.data;
	const collection = useCollection(WORKFLOWS_COLLECTION, workflows);
	const canManage = useOrgPermission(org, "workflows:manage");
	useLiveWork(org, repoId);
	const motion = useAgentMotion();

	const createMutation = useMutation({
		mutationFn: (
			definition?: WorkflowTemplate["definition"] & {
				id: string;
				name: string;
			},
		) => createRepoWorkflow({ data: { org, repoId, definition } }),
		onSuccess: (result, definition) => {
			if (result.workflow) {
				trackEvent("workflow_created", { from_template: Boolean(definition) });
				navigate({
					to: "/$org/$repo/workflows/$workflowId",
					params: { org, repo: repoName, workflowId: result.workflow.id },
				});
				return;
			}
			notify.show(
				{
					title:
						result.error ??
						"Tripwire could not create the workflow. Try again.",
				},
				"error",
			);
		},
		onError: () => {
			notify.show(
				{ title: "Tripwire could not create the workflow. Try again." },
				"error",
			);
		},
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: workflowsQueryKeys.list(org, repoId),
			});
		},
	});

	const createBlank = () => createMutation.mutate(undefined);
	const createFromTemplate = (tpl: WorkflowTemplate) =>
		createMutation.mutate({
			...tpl.definition,
			id: crypto.randomUUID(),
			name: tpl.name,
		});

	const hasWorkflows = (workflows?.length ?? 0) > 0;

	// The queue's baseline is the SERVER's enabled flag, so a toggle flipped back
	// to its saved value clears itself out of the batch.
	const savedValues = useMemo(
		() =>
			Object.fromEntries(
				(workflows ?? []).map((w) => [enabledKey(w.id), w.enabled]),
			),
		[workflows],
	);

	/**
	 * One batch, one write per flipped workflow. Enabling runs the strict
	 * validator server-side and can refuse — that workflow's key stays queued
	 * (so its toggle keeps the user's intent on screen) while the rest clear.
	 */
	const commitEnabled = async (pending: SaveQueueValues) => {
		const failedKeys: string[] = [];
		const refusals: string[] = [];
		let succeeded = 0;

		for (const [key, value] of Object.entries(pending)) {
			const workflowId = key.split(":")[0] ?? "";
			const name =
				(workflows ?? []).find((w) => w.id === workflowId)?.name ?? "workflow";
			try {
				const result = await setRepoWorkflowEnabled({
					data: { org, repoId, workflowId, enabled: Boolean(value) },
				});
				if (!result.ok) {
					failedKeys.push(key);
					refusals.push(
						`${name}: ${result.issues
							.slice(0, 2)
							.map((issue) => issue.message)
							.join("; ")}`,
					);
					continue;
				}
				succeeded += 1;
				trackEvent("workflow_enabled", { enabled: Boolean(value) });
			} catch {
				failedKeys.push(key);
				refusals.push(
					`${name}: Tripwire could not reach the server. Try again.`,
				);
			}
		}

		if (succeeded > 0) {
			await queryClient.invalidateQueries({
				queryKey: workflowsQueryKeys.list(org, repoId),
			});
		}
		if (failedKeys.length === 0) {
			notify.show({ title: "Workflow changes saved" }, "success");
			return { ok: true as const };
		}
		const message = refusals.join(" ");
		notify.show({ title: message }, "error");
		return { error: message, failedKeys };
	};

	return (
		<SaveQueueProvider commit={commitEnabled} savedValues={savedValues}>
			<DashboardLayout counts={{}}>
				<Page purpose="task">
					<PageHeader
						actions={
							canManage && hasWorkflows ? (
								<CreateSplitButton
									creating={createMutation.isPending}
									onBlank={createBlank}
									onTemplate={createFromTemplate}
								/>
							) : undefined
						}
						description="What this repo runs against change requests: triggers, rules, gates and actions."
						title="Workflows"
					/>
					<PageBody>
						<Collection
							collection={collection}
							empty={
								<WorkflowsEmpty
									creating={createMutation.isPending}
									canManage={canManage}
									onBlank={createBlank}
									onTemplate={createFromTemplate}
									org={org}
									repoName={repoName}
								/>
							}
							error={workflowsQuery.isError}
							onRetry={async () => {
								await workflowsQuery.refetch({ throwOnError: true });
							}}
							skeleton={<GridSkeleton />}
						>
							{(rows) => (
								<ul aria-label="Workflows" className="flex flex-col gap-3">
									{repo
										? rows.map((workflow) => (
												<li key={workflow.id}>
													<WorkflowRow
														canManage={canManage}
														forge={repo.forge}
														motion={motion}
														org={org}
														repoId={repoId}
														repoName={repoName}
														workflow={workflow}
													/>
												</li>
											))
										: null}
								</ul>
							)}
						</Collection>
					</PageBody>
					<UnsavedChangesBar />
				</Page>
			</DashboardLayout>
		</SaveQueueProvider>
	);
}

function CreateSplitButton({
	creating,
	onBlank,
	onTemplate,
}: {
	creating: boolean;
	onBlank: () => void;
	onTemplate: (tpl: WorkflowTemplate) => void;
}) {
	const actionsWrap = useMediaQuery("(max-width: 30rem)");

	return (
		<ButtonGroup aria-label="New workflow" className="shrink-0">
			<Button
				leadingIcon={<Icon icon={Add} />}
				onAction={onBlank}
				pending={creating}
				pendingLabel="Creating"
				reservePendingWidth
				size="small"
				variant="secondary"
			>
				Create workflow
			</Button>
			<ButtonGroupMenu
				align={actionsWrap ? "start" : "end"}
				items={[
					{
						items: WORKFLOW_TEMPLATES.map((tpl) => ({
							label: `Start from ${tpl.name}`,
							onAction: () => onTemplate(tpl),
							value: tpl.id,
						})),
						label: "Templates",
						type: "group",
						value: "templates",
					},
				]}
				label="Start from a template"
				pending={creating}
				size="small"
			/>
		</ButtonGroup>
	);
}

function WorkflowsEmpty({
	org,
	repoName,
	canManage,
	creating,
	onBlank,
	onTemplate,
}: {
	org: string;
	repoName: string;
	canManage: boolean;
	creating: boolean;
	onBlank: () => void;
	onTemplate: (tpl: WorkflowTemplate) => void;
}) {
	if (!canManage) {
		return (
			<EmptyState art={<MascotArt mood="workflows-empty" />}>
				<EmptyStateHeader>
					<EmptyStateTitle>No workflows yet</EmptyStateTitle>
					<EmptyStateDescription>
						Only org admins can create workflows. Ask an admin to add one.
					</EmptyStateDescription>
				</EmptyStateHeader>
				<EmptyStateContent>
					<Button
						href={`/${org}/${repoName}/rules`}
						size="small"
						variant="secondary"
					>
						Review rules
					</Button>
				</EmptyStateContent>
			</EmptyState>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<EmptyState
				art={<MascotArt mood="workflows-empty" />}
				className="relative isolate overflow-hidden"
			>
				<ShaderDither className="-z-10 bottom-auto h-30" priority={1} />
				<EmptyStateHeader>
					<EmptyStateTitle>No workflows yet</EmptyStateTitle>
					<EmptyStateDescription>
						Build one from scratch, or start from a template below.
					</EmptyStateDescription>
				</EmptyStateHeader>
				<EmptyStateContent>
					<Button
						onAction={onBlank}
						pending={creating}
						pendingLabel="Creating"
						size="small"
					>
						<Icon icon={Add} />
						Create workflow
					</Button>
				</EmptyStateContent>
			</EmptyState>
			<section
				aria-labelledby="workflow-templates"
				className="flex flex-col gap-2"
			>
				<h2 className="type-heading-sm" id="workflow-templates">
					Templates
				</h2>
				<ItemGroup aria-label="Templates">
					{WORKFLOW_TEMPLATES.map((tpl) => (
						<Item key={tpl.id}>
							<ItemContent>
								<ItemTitle>
									<span>{tpl.name}</span>
								</ItemTitle>
								<ItemDescription>{tpl.description}</ItemDescription>
							</ItemContent>
							<ItemActions>
								<Button
									ariaLabel={`Use the ${tpl.name} template`}
									disabled={creating}
									onAction={() => onTemplate(tpl)}
									size="small"
									variant="secondary"
								>
									Use template
								</Button>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			</section>
		</div>
	);
}

function WorkflowRow({
	forge,
	org,
	repoName,
	repoId,
	workflow,
	canManage,
	motion,
}: {
	forge: Forge;
	org: string;
	repoName: string;
	repoId: string;
	workflow: WorkflowCard;
	canManage: boolean;
	motion: AgentMotion;
}) {
	const protectionAvailable = forgeEvaluates(forge);
	const protectionReasonId = `${workflow.id}-protection-unavailable`;
	const now = useWorkClock(workflow.work);
	const agents = workingAgents(workflow.work, now);
	const draftOnly =
		workflow.draftId !== null && workflow.id === workflow.draftId;
	const queryClient = useQueryClient();
	const listKey = workflowsQueryKeys.list(org, repoId);

	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(workflow.name);
	const [deleting, setDeleting] = useState(false);
	const [turningOff, setTurningOff] = useState(false);

	const invalidateList = () => {
		queryClient.invalidateQueries({ queryKey: listKey });
	};

	// The toggle writes to the batch, never to the server — the page's provider
	// owns persistence. `queuedEnabled` is pending-or-saved (what the switch
	// shows); `workflow.enabled` stays the SERVER's answer.
	const [queuedEnabled, setQueuedEnabled] = useSaveQueueField<boolean>(
		enabledKey(workflow.id),
	);

	const renameMutation = useMutation({
		mutationFn: (name: string) =>
			renameRepoWorkflow({
				data: { org, repoId, workflowId: workflow.id, name },
			}),
		onSettled: invalidateList,
	});

	const duplicateMutation = useMutation({
		mutationFn: () =>
			duplicateRepoWorkflow({ data: { org, repoId, workflowId: workflow.id } }),
		onSuccess: (result) => {
			if (!result.workflow) {
				notify.show(
					{
						title:
							result.error ??
							"Tripwire could not duplicate the workflow. Try again.",
					},
					"error",
				);
				return;
			}
			notify.show({ title: `Duplicated ${workflow.name}` }, "success");
		},
		onError: () => {
			notify.show(
				{ title: "Tripwire could not duplicate the workflow. Try again." },
				"error",
			);
		},
		onSettled: invalidateList,
	});

	const deleteMutation = useMutation({
		mutationFn: () =>
			deleteRepoWorkflow({ data: { org, repoId, workflowId: workflow.id } }),
		onSettled: invalidateList,
	});

	const submitRename = async () => {
		const trimmed = renameValue.trim();
		if (trimmed.length === 0) {
			throw new Error("Give the workflow a name.");
		}
		const result = await renameMutation.mutateAsync(trimmed);
		if (!result.ok) {
			throw new Error(
				result.error ?? "Tripwire could not rename the workflow. Try again.",
			);
		}
	};

	const submitDelete = async () => {
		const result = await deleteMutation.mutateAsync();
		if (!result.deleted) {
			throw new Error("Tripwire could not delete the workflow. Try again.");
		}
	};
	const description =
		agents.length > 0 ? (
			<AgentPresence agents={agents} motion={motion} />
		) : workflow.triggerKinds.length === 0 ? (
			"No trigger yet"
		) : undefined;
	const menuItems: MenuEntry[] = [
		{
			label: "Rename workflow",
			onAction: () => {
				setRenameValue(workflow.name);
				setRenaming(true);
			},
			value: "rename",
		},
		{
			disabled: duplicateMutation.isPending,
			label: "Duplicate workflow",
			onAction: () => duplicateMutation.mutate(),
			value: "duplicate",
		},
		{ type: "separator", value: "destructive-separator" },
		{
			label: "Delete workflow",
			onAction: () => setDeleting(true),
			value: "delete",
		},
	];

	return (
		<>
			<div className="relative">
				<AgentOutline
					active={agents.length > 0}
					motion={motion}
					radius={14}
					seed={workflow.id}
				/>
				<EntityCard
					footerLayout="workflow"
					feedbackName="WorkflowRow"
					badges={
						workflow.draftId || workflow.triggerKinds.length > 0 ? (
							<>
								{workflow.draftId ? (
									<Badge variant="outline">Draft</Badge>
								) : null}
								{workflow.triggerKinds.map((kind) => (
									<Badge key={kind} variant="outline">
										{humanizeTriggerKind(kind)}
									</Badge>
								))}
							</>
						) : undefined
					}
					description={
						protectionAvailable ? (
							description
						) : (
							<>
								{description}
								<span className="block" id={protectionReasonId}>
									{FORGE_BY_ID[forge].label} protection is unavailable. Checks
									aren't available yet.
								</span>
							</>
						)
					}
					footerActions={
						workflow.draftId && canManage ? (
							<div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 overflow-visible whitespace-normal">
								<DraftActions
									draftId={workflow.draftId}
									name={workflow.name}
									org={org}
									replacesLive={workflow.enabled}
									repoId={repoId}
								/>
							</div>
						) : undefined
					}
					footerMeta={
						<MetaRow>
							<span className="tabular-nums">
								{workflow.nodeCount}{" "}
								{workflow.nodeCount === 1 ? "step" : "steps"}
							</span>
							<span>
								Updated <ZonedTime at={workflow.updatedAt} format="short" />
							</span>
							{canManage ? null : <span>Read only</span>}
						</MetaRow>
					}
					status={
						draftOnly ? undefined : (
							<>
								<Status size="small" status={STATE_STATUS[workflow.state]}>
									{WORKFLOW_STATE_LABELS[workflow.state]}
								</Status>
								<Switch
									ariaDescribedBy={
										protectionAvailable ? undefined : protectionReasonId
									}
									ariaLabel={`Run ${workflow.name} on change requests`}
									checked={queuedEnabled}
									disabled={
										!canManage || (!queuedEnabled && !protectionAvailable)
									}
									onCheckedChange={(enabled) => {
										if (!enabled) {
											setTurningOff(true);
											return;
										}
										if (protectionAvailable) setQueuedEnabled(true);
									}}
									size="small"
								/>
								{canManage ? (
									<Menu
										align="end"
										ariaLabel={`Actions for ${workflow.name}`}
										items={menuItems}
										trigger={
											<IconButton
												icon={<Icon icon={MoreVertical} />}
												label={`Actions for ${workflow.name}`}
												size="small"
												variant="ghost"
											/>
										}
									/>
								) : null}
							</>
						)
					}
					title={
						<CardRouterLink
							data-layout-role="workflow-name"
							params={{ org, repo: repoName, workflowId: workflow.id }}
							to="/$org/$repo/workflows/$workflowId"
						>
							{workflow.name}
						</CardRouterLink>
					}
				/>
			</div>

			<Dialog
				action={{
					disabled: renameValue.trim().length === 0,
					label: "Save name",
					onAction: submitRename,
					pendingLabel: "Saving",
				}}
				onOpenChange={setRenaming}
				open={renaming}
				title={`Rename ${workflow.name}`}
			>
				<Field>
					<FieldLabel>Workflow name</FieldLabel>
					<Input
						autoComplete="off"
						labelledByField
						maxLength={120}
						onChange={(event) => setRenameValue(event.target.value)}
						value={renameValue}
					/>
				</Field>
			</Dialog>

			<ConfirmDeleteDialog
				description="This can't be undone."
				onConfirm={submitDelete}
				onOpenChange={setDeleting}
				open={deleting}
				title={`Delete ${workflow.name}?`}
			/>
			<ConfirmDestructiveDialog
				confirmLabel="Turn off workflow"
				description={`${workflow.name} will stop evaluating new change requests after you save this change.`}
				onConfirm={() => {
					setQueuedEnabled(false);
					return undefined;
				}}
				onOpenChange={setTurningOff}
				open={turningOff}
				pendingLabel="Turning off"
				title={`Turn off ${workflow.name}?`}
			/>
		</>
	);
}
