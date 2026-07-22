import {
	Add01Icon,
	ArrowDown01Icon,
	MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { Switch } from "#/components/ui/switch";
import { toast } from "#/components/ui/toast";
import { GridSkeleton } from "#/components/workflows/workflows-grid-page-skeleton";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import type { WorkflowTemplate } from "#/lib/workflow-templates";
import { WORKFLOW_TEMPLATES } from "#/lib/workflow-templates";
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

const route = getRouteApi("/$org/$repo/workflows/");

/** "change-request.opened" → "change request opened" */
function humanizeTriggerKind(kind: string): string {
	return kind.replace(/[.-]/g, " ");
}

function triggerSummary(kinds: string[]): string {
	if (kinds.length === 0) {
		return "no trigger yet";
	}
	return `on ${kinds.map(humanizeTriggerKind).join(", ")}`;
}

/**
 * The workflows GRID (§grid) — every workflow this repo runs, as cards.
 * Members see it read-only (cosmetic; the server enforces). Templates are
 * face-up only in the empty state; once real workflows exist they demote
 * into the create dropdown.
 */
export function WorkflowsGridPage() {
	const { org, repo: repoName } = route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const repoId = repo?.id ?? "";
	const { data: workflows } = useQuery(workflowsListQueryOptions(org, repoId));
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const isAdmin = orgContext?.role === "admin";

	const createMutation = useMutation({
		mutationFn: (
			definition?: WorkflowTemplate["definition"] & {
				id: string;
				name: string;
			},
		) => createRepoWorkflow({ data: { org, repoId, definition } }),
		onSuccess: (result) => {
			if (result.workflow) {
				navigate({
					to: "/$org/$repo/workflows/$workflowId",
					params: { org, repo: repoName, workflowId: result.workflow.id },
				});
				return;
			}
			toast(result.error ?? "could not create workflow");
		},
		onError: () => {
			toast("could not create workflow");
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

	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<header className="flex items-start justify-between gap-4">
						<div className="flex flex-col gap-1.5">
							<h1 className="font-semibold text-2xl tracking-tight">
								Workflows
							</h1>
							<p className="text-muted-foreground text-sm">
								what this repo runs against change requests — triggers, rules,
								gates, actions.
							</p>
						</div>
						{isAdmin && hasWorkflows ? (
							<CreateSplitButton
								disabled={createMutation.isPending}
								onBlank={createBlank}
								onTemplate={createFromTemplate}
							/>
						) : null}
					</header>

					{workflows === undefined ? (
						<GridSkeleton />
					) : hasWorkflows ? (
						<div className="grid gap-4 sm:grid-cols-2">
							{workflows.map((workflow) => (
								<WorkflowCard
									isAdmin={isAdmin}
									key={workflow.id}
									org={org}
									repoId={repoId}
									repoName={repoName}
									workflow={workflow}
								/>
							))}
						</div>
					) : (
						<EmptyState
							creating={createMutation.isPending}
							isAdmin={isAdmin}
							onBlank={createBlank}
							onTemplate={createFromTemplate}
						/>
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}

// ── create CTA (populated state) ─────────────────────────────────────────

function CreateSplitButton({
	disabled,
	onBlank,
	onTemplate,
}: {
	disabled: boolean;
	onBlank: () => void;
	onTemplate: (tpl: WorkflowTemplate) => void;
}) {
	return (
		<div className="flex shrink-0 items-center">
			<Button
				className="rounded-r-none"
				disabled={disabled}
				onClick={onBlank}
				size="sm"
			>
				<HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
				new workflow
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label="start from a template"
						className="rounded-l-none border-primary-foreground/20 border-l"
						disabled={disabled}
						size="sm"
					>
						<HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuLabel>templates</DropdownMenuLabel>
					{WORKFLOW_TEMPLATES.map((tpl) => (
						<DropdownMenuItem key={tpl.id} onClick={() => onTemplate(tpl)}>
							start from: {tpl.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

// ── empty state — face-up templates ──────────────────────────────────────

function EmptyState({
	isAdmin,
	creating,
	onBlank,
	onTemplate,
}: {
	isAdmin: boolean;
	creating: boolean;
	onBlank: () => void;
	onTemplate: (tpl: WorkflowTemplate) => void;
}) {
	if (!isAdmin) {
		return (
			<p className="rounded-xl border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
				no workflows yet. an admin can create one.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
				<p className="text-muted-foreground text-sm">
					no workflows yet. build one from scratch, or start from a template
					below.
				</p>
				<Button disabled={creating} onClick={onBlank}>
					<HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={2} />
					create a workflow
				</Button>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				{WORKFLOW_TEMPLATES.map((tpl) => (
					<Card key={tpl.id}>
						<CardHeader>
							<CardTitle className="text-base">{tpl.name}</CardTitle>
							<CardDescription>{tpl.description}</CardDescription>
						</CardHeader>
						<div className="px-6 pb-5">
							<Button
								disabled={creating}
								onClick={() => onTemplate(tpl)}
								size="sm"
								variant="outline"
							>
								use template
							</Button>
						</div>
					</Card>
				))}
			</div>
		</div>
	);
}

// ── workflow card ────────────────────────────────────────────────────────

type ConfirmState = "closed" | "confirm";

function WorkflowCard({
	org,
	repoName,
	repoId,
	workflow,
	isAdmin,
}: {
	org: string;
	repoName: string;
	repoId: string;
	workflow: WorkflowListItem;
	isAdmin: boolean;
}) {
	const queryClient = useQueryClient();
	const listKey = workflowsQueryKeys.list(org, repoId);

	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(workflow.name);
	const [confirmState, setConfirmState] = useState<ConfirmState>("closed");
	const [confirmName, setConfirmName] = useState("");

	const invalidateList = () => {
		queryClient.invalidateQueries({ queryKey: listKey });
	};

	const setWorkflowEnabledInCache = (enabled: boolean) => {
		queryClient.setQueryData<WorkflowListItem[]>(listKey, (prev) =>
			prev?.map((w) => (w.id === workflow.id ? { ...w, enabled } : w)),
		);
	};

	const enableMutation = useMutation({
		mutationFn: (enabled: boolean) =>
			setRepoWorkflowEnabled({
				data: { org, repoId, workflowId: workflow.id, enabled },
			}),
		onMutate: async (enabled) => {
			await queryClient.cancelQueries({ queryKey: listKey });
			const previous = queryClient.getQueryData<WorkflowListItem[]>(listKey);
			setWorkflowEnabledInCache(enabled);
			return { previous };
		},
		onSuccess: (result) => {
			if (!result.ok) {
				toast(
					`can't enable: ${result.issues
						.slice(0, 3)
						.map((issue) => issue.message)
						.join("; ")}`,
				);
				setWorkflowEnabledInCache(false);
			}
		},
		onError: (_error, _enabled, context) => {
			if (context?.previous) {
				queryClient.setQueryData(listKey, context.previous);
			}
			toast("toggle refused — try again");
		},
		onSettled: invalidateList,
	});

	const renameMutation = useMutation({
		mutationFn: (name: string) =>
			renameRepoWorkflow({
				data: { org, repoId, workflowId: workflow.id, name },
			}),
		onSuccess: (result) => {
			if (result.ok) {
				setRenaming(false);
			} else {
				toast(result.error ?? "rename refused");
			}
		},
		onError: () => {
			toast("rename refused");
		},
		onSettled: invalidateList,
	});

	const duplicateMutation = useMutation({
		mutationFn: () =>
			duplicateRepoWorkflow({ data: { org, repoId, workflowId: workflow.id } }),
		onSuccess: (result) => {
			if (!result.workflow) {
				toast(result.error ?? "duplicate refused");
			}
		},
		onError: () => {
			toast("duplicate refused");
		},
		onSettled: invalidateList,
	});

	const deleteMutation = useMutation({
		mutationFn: () =>
			deleteRepoWorkflow({ data: { org, repoId, workflowId: workflow.id } }),
		onSuccess: (result) => {
			if (!result.deleted) {
				toast("delete refused");
			}
		},
		onError: () => {
			toast("delete refused");
		},
		onSettled: invalidateList,
	});

	const deleteConfirmReady = !workflow.enabled || confirmName === workflow.name;

	return (
		<Card className="relative gap-0 py-0 transition-colors hover:border-ring/40">
			{/* stretched link — the whole card body navigates; controls sit above it */}
			<Link
				aria-label={`open ${workflow.name}`}
				className="absolute inset-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				params={{ org, repo: repoName, workflowId: workflow.id }}
				to="/$org/$repo/workflows/$workflowId"
			/>
			<div className="flex flex-col gap-3 p-5">
				<div className="flex items-start justify-between gap-3">
					{renaming ? (
						<form
							className="relative z-10 flex flex-1 items-center gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								const trimmed = renameValue.trim();
								if (trimmed.length > 0 && !renameMutation.isPending) {
									renameMutation.mutate(trimmed);
								}
							}}
						>
							<Input
								aria-label="workflow name"
								autoFocus
								className="h-8"
								maxLength={120}
								onChange={(e) => setRenameValue(e.target.value)}
								value={renameValue}
							/>
							<Button
								disabled={
									renameValue.trim().length === 0 || renameMutation.isPending
								}
								size="xs"
								type="submit"
							>
								save
							</Button>
							<Button
								onClick={() => {
									setRenaming(false);
									setRenameValue(workflow.name);
								}}
								size="xs"
								type="button"
								variant="ghost"
							>
								cancel
							</Button>
						</form>
					) : (
						<p className="min-w-0 truncate font-medium text-sm">
							{workflow.name}
						</p>
					)}
					<div className="relative z-10 flex shrink-0 items-center gap-1">
						<Switch
							aria-label={`${workflow.enabled ? "disable" : "enable"} ${workflow.name}`}
							checked={workflow.enabled}
							disabled={!isAdmin || enableMutation.isPending}
							onCheckedChange={(checked) => enableMutation.mutate(checked)}
						/>
						{isAdmin ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										aria-label={`actions for ${workflow.name}`}
										className="size-7"
										size="icon"
										variant="ghost"
									>
										<HugeiconsIcon icon={MoreVerticalIcon} size={16} />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem
										onClick={() => {
											setRenameValue(workflow.name);
											setRenaming(true);
										}}
									>
										rename
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={duplicateMutation.isPending}
										onClick={() => duplicateMutation.mutate()}
									>
										duplicate
									</DropdownMenuItem>
									<DropdownMenuItem
										className="text-destructive focus:text-destructive"
										onClick={() => {
											setConfirmName("");
											setConfirmState("confirm");
										}}
									>
										delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</div>
				</div>
				<p className="truncate text-muted-foreground text-xs">
					{triggerSummary(workflow.triggerKinds)} · {workflow.nodeCount}{" "}
					{workflow.nodeCount === 1 ? "node" : "nodes"}
				</p>
				<p className="text-muted-foreground text-xs">
					updated {formatRelativeTime(workflow.updatedAt)}
				</p>
			</div>

			{confirmState === "confirm" ? (
				<div className="relative z-10 flex flex-col gap-2 border-t bg-destructive/5 p-4">
					{workflow.enabled ? (
						<>
							<p className="text-destructive text-xs">
								this workflow is LIVE — it runs against change requests right
								now. type its name to delete.
							</p>
							<Input
								aria-label="type the workflow name to confirm deletion"
								autoFocus
								className="h-8"
								onChange={(e) => setConfirmName(e.target.value)}
								placeholder={workflow.name}
								value={confirmName}
							/>
						</>
					) : (
						<p className="text-destructive text-xs">
							delete {workflow.name}? drafts are gone for good.
						</p>
					)}
					<div className="flex items-center gap-2">
						<Button
							disabled={!deleteConfirmReady || deleteMutation.isPending}
							onClick={() => deleteMutation.mutate()}
							size="xs"
							variant="destructive"
						>
							delete
						</Button>
						<Button
							onClick={() => setConfirmState("closed")}
							size="xs"
							variant="ghost"
						>
							cancel
						</Button>
					</div>
				</div>
			) : null}
		</Card>
	);
}
