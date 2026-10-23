import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
	WORKFLOW_STATE_LABELS,
	WORKFLOW_TEMPLATES,
	type WorkflowState,
	type WorkflowTemplate,
} from "@tripwire/contracts";
import { useMemo, useState } from "react";
import { Collection } from "#/components/collection/collection";
import { EntityCard } from "#/components/common/entity-card";
import { MetaRow } from "#/components/common/meta-row";
import { CardRouterLink } from "#/components/common/router-links";
import { ShaderDither } from "#/components/dither/shader-dither";
import { Add, Icon, MoreVertical } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	ButtonGroup,
	ButtonGroupMenu,
} from "#/components/glaze/ui/button-group";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogConfirmField,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { Status, type StatusValue } from "#/components/glaze/ui/status";
import { Switch } from "#/components/glaze/ui/switch";
import { toast } from "#/components/glaze/ui/toast";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	SaveQueueProvider,
	UnsavedChangesBar,
	useSaveQueueField,
} from "#/components/save-queue";
import { ZonedTime } from "#/components/timezones/zoned-time";
import {
	humanizeTriggerKind,
	WORKFLOWS_COLLECTION,
} from "#/components/workflows/workflows-collection";
import { GridSkeleton } from "#/components/workflows/workflows-grid-page-skeleton";
import { useCollection } from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { orgRepoQueryOptions } from "#/lib/org.query";
import { trackEvent } from "#/lib/track";
import type { WorkflowListItem } from "#/lib/workflows.functions";
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

const STATE_STATUS: Record<WorkflowState, StatusValue> = {
	on: "ok",
	off: "idle",
	"cant-run": "warn",
	"needs-fixes": "warn",
	"cant-turn-on": "idle",
};

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
			toast.fail(
				result.error ?? "Tripwire could not create the workflow. Try again.",
			);
		},
		onError: () => {
			toast.fail("Tripwire could not create the workflow. Try again.");
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
	const commitEnabled = async (pending: Record<string, unknown>) => {
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
			toast.success("Workflow changes saved");
			return { ok: true as const };
		}
		const message = refusals.join(" ");
		toast.fail(message);
		return { error: message, failedKeys };
	};

	return (
		<SaveQueueProvider commit={commitEnabled} savedValues={savedValues}>
			<DashboardLayout counts={{}}>
				<div className="px-4 py-6 md:px-8 md:py-10">
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
						<header className="flex flex-wrap items-start justify-between gap-4">
							<div className="flex min-w-0 flex-col gap-1">
								<h1 className="type-title">Workflows</h1>
								<p className="type-body text-text-2">
									What this repo runs against change requests: triggers, rules,
									gates and actions.
								</p>
							</div>
							{canManage && hasWorkflows ? (
								<CreateSplitButton
									creating={createMutation.isPending}
									onBlank={createBlank}
									onTemplate={createFromTemplate}
								/>
							) : null}
						</header>

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
									{rows.map((workflow) => (
										<li key={workflow.id}>
											<WorkflowRow
												canManage={canManage}
												org={org}
												repoId={repoId}
												repoName={repoName}
												workflow={workflow}
											/>
										</li>
									))}
								</ul>
							)}
						</Collection>
					</div>
					<UnsavedChangesBar />
				</div>
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
	return (
		<ButtonGroup aria-label="New workflow" className="shrink-0">
			<Button
				onClick={onBlank}
				pending={creating}
				pendingLabel="Creating"
				size="sm"
				variant="secondary"
			>
				<Icon icon={Add} />
				Create workflow
			</Button>
			<ButtonGroupMenu
				label="Start from a template"
				pending={creating}
				size="sm"
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Templates</DropdownMenuLabel>
					{WORKFLOW_TEMPLATES.map((tpl) => (
						<DropdownMenuItem key={tpl.id} onClick={() => onTemplate(tpl)}>
							Start from {tpl.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</ButtonGroupMenu>
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
			<Empty art={<MascotArt mood="workflows-empty" />}>
				<EmptyHeader>
					<EmptyTitle>No workflows yet</EmptyTitle>
					<EmptyDescription>
						Only org admins can create workflows. Ask an admin to add one.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						nativeButton={false}
						render={
							<Link params={{ org, repo: repoName }} to="/$org/$repo/rules" />
						}
						size="sm"
						variant="secondary"
					>
						Review rules
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<Empty
				art={<MascotArt mood="workflows-empty" />}
				className="relative isolate overflow-hidden"
			>
				<ShaderDither className="-z-10 bottom-auto h-30" priority={1} />
				<EmptyHeader>
					<EmptyTitle>No workflows yet</EmptyTitle>
					<EmptyDescription>
						Build one from scratch, or start from a template below.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						onClick={onBlank}
						pending={creating}
						pendingLabel="Creating"
						size="sm"
					>
						<Icon icon={Add} />
						Create workflow
					</Button>
				</EmptyContent>
			</Empty>
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
									aria-label={`Use the ${tpl.name} template`}
									disabled={creating}
									onClick={() => onTemplate(tpl)}
									size="sm"
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
	org,
	repoName,
	repoId,
	workflow,
	canManage,
}: {
	org: string;
	repoName: string;
	repoId: string;
	workflow: WorkflowListItem;
	canManage: boolean;
}) {
	const queryClient = useQueryClient();
	const listKey = workflowsQueryKeys.list(org, repoId);

	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(workflow.name);
	const [deleting, setDeleting] = useState(false);

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
				toast.fail(
					result.error ??
						"Tripwire could not duplicate the workflow. Try again.",
				);
				return;
			}
			toast.success(`Duplicated ${workflow.name}`);
		},
		onError: () => {
			toast.fail("Tripwire could not duplicate the workflow. Try again.");
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

	return (
		<>
			<EntityCard
				badges={
					workflow.triggerKinds.length > 0
						? workflow.triggerKinds.map((kind) => (
								<Badge key={kind} variant="outline">
									{humanizeTriggerKind(kind)}
								</Badge>
							))
						: undefined
				}
				description={
					workflow.triggerKinds.length === 0 ? "No trigger yet" : undefined
				}
				footerMeta={
					<MetaRow>
						<span className="tabular-nums">
							{workflow.nodeCount} {workflow.nodeCount === 1 ? "step" : "steps"}
						</span>
						<span>
							Updated <ZonedTime at={workflow.updatedAt} format="short" />
						</span>
						{canManage ? null : <span>Read only</span>}
					</MetaRow>
				}
				status={
					<>
						<Status size="sm" status={STATE_STATUS[workflow.state]}>
							{WORKFLOW_STATE_LABELS[workflow.state]}
						</Status>
						<Switch
							aria-label={`Run ${workflow.name} on change requests`}
							checked={queuedEnabled}
							disabled={!canManage}
							onCheckedChange={setQueuedEnabled}
							size="sm"
						/>
						{canManage ? (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											aria-label={`Actions for ${workflow.name}`}
											size="icon-sm"
											variant="ghost"
										/>
									}
								>
									<Icon icon={MoreVertical} />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" size="sm">
									<DropdownMenuItem
										onClick={() => {
											setRenameValue(workflow.name);
											setRenaming(true);
										}}
									>
										Rename workflow
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={duplicateMutation.isPending}
										onClick={() => duplicateMutation.mutate()}
									>
										Duplicate workflow
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onClick={() => setDeleting(true)}
										variant="destructive"
									>
										Delete workflow
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</>
				}
				title={
					<CardRouterLink
						params={{ org, repo: repoName, workflowId: workflow.id }}
						to="/$org/$repo/workflows/$workflowId"
					>
						{workflow.name}
					</CardRouterLink>
				}
			/>

			<Dialog onOpenChange={setRenaming} open={renaming}>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Rename {workflow.name}</DialogTitle>
					</DialogHeader>
					<DialogBody>
						<Field>
							<FieldLabel>Workflow name</FieldLabel>
							<Input
								autoComplete="off"
								maxLength={120}
								onChange={(event) => setRenameValue(event.target.value)}
								value={renameValue}
							/>
						</Field>
					</DialogBody>
					<DialogFooter>
						<DialogClose>Cancel</DialogClose>
						<DialogAction
							disabled={renameValue.trim().length === 0}
							onAction={submitRename}
							pendingLabel="Saving"
						>
							Save name
						</DialogAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				confirmText={workflow.enabled ? workflow.name : undefined}
				onOpenChange={setDeleting}
				open={deleting}
				role="alertdialog"
			>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Delete {workflow.name}?</DialogTitle>
						<DialogDescription>
							{workflow.enabled
								? "This workflow is on and checks change requests right now. Deleting it stops those checks, and you cannot undo it."
								: "This draft is deleted for good. You cannot undo it."}
						</DialogDescription>
					</DialogHeader>
					{workflow.enabled ? (
						<DialogBody>
							<DialogConfirmField />
						</DialogBody>
					) : null}
					<DialogFooter>
						<DialogClose>Cancel</DialogClose>
						<DialogAction
							onAction={submitDelete}
							pendingLabel="Deleting"
							variant="destructive"
						>
							Delete workflow
						</DialogAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
