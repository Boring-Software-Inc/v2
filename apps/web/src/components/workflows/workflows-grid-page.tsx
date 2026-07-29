import {
	Add01Icon,
	ArrowDown01Icon,
	MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	SaveQueueProvider,
	UnsavedChangesBar,
	useSaveQueueField,
} from "#/components/save-queue";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Dither } from "#/components/ui/dither";
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

/** Queue key for a workflow's enabled flag. */
const enabledKey = (workflowId: string) => `${workflowId}:enabled`;

/**
 * Quantized easing: opacity lands on seven discrete levels instead of ramping
 * smoothly, so the texture materialises in bands the way an ordered dither
 * thresholds a gradient. A plain fade would read as a generic tooltip.
 * Opacity-only, so it survives `reducedMotion="user"` as a crossfade.
 */
const DITHER_RAMP = (t: number) => Math.round(t * 6) / 6;

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
			} catch {
				failedKeys.push(key);
				refusals.push(`${name}: couldn't reach the server`);
			}
		}

		if (succeeded > 0) {
			await queryClient.invalidateQueries({
				queryKey: workflowsQueryKeys.list(org, repoId),
			});
		}
		if (failedKeys.length === 0) {
			toast.success("changes saved.");
			return { ok: true as const };
		}
		const message = refusals.join(" · ");
		toast.error(message);
		return { error: message, failedKeys };
	};

	return (
		<SaveQueueProvider commit={commitEnabled} savedValues={savedValues}>
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
					{/* Mounting the bar is what arms the nav guard while dirty. */}
					<UnsavedChangesBar />
				</div>
			</DashboardLayout>
		</SaveQueueProvider>
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
				<DropdownMenuTrigger
					disabled={disabled}
					render={
						<Button
							aria-label="start from a template"
							className="rounded-l-none border-primary-foreground/20 border-l"
							size="sm"
						/>
					}
				>
					<HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} />
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

	// The toggle writes to the batch, never to the server — the page's provider
	// owns persistence. `queuedEnabled` is pending-or-saved (what the switch
	// shows); `workflow.enabled` stays the SERVER's answer and is what the
	// dither reads.
	const [queuedEnabled, setQueuedEnabled] = useSaveQueueField<boolean>(
		enabledKey(workflow.id),
	);

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
		<div className="relative isolate flex flex-col gap-1 overflow-hidden rounded-[10px] border border-border bg-surface-2 p-0.5 transition-colors hover:border-ring/40">
			{/* The house dither backs the WHOLE card, not just the header. -z-10 plus
			    the root's `isolate` keeps it under the content and the stretched link.
			    It is gated on `workflow.enabled` — the SERVER's flag, never the
			    queued toggle — so texture on the card always means the workflow is
			    genuinely live. Flipping the switch does nothing here until the batch
			    saves and the list refetches. `initial={false}` keeps already-enabled
			    cards from animating on page load. */}
			<AnimatePresence initial={false}>
				{workflow.enabled ? (
					<motion.div
						animate={{ opacity: 1 }}
						className="pointer-events-none absolute inset-0 -z-10"
						exit={{ opacity: 0 }}
						initial={{ opacity: 0 }}
						key="dither"
						transition={{ duration: 0.5, ease: DITHER_RAMP }}
					>
						<Dither speed={1.22} />
					</motion.div>
				) : null}
			</AnimatePresence>
			{/* Stretched link — the whole card navigates. `z-10` is load-bearing: the
			    header and body below are positioned and come later in the DOM, so
			    without it they paint over the link and the card has no clickable
			    surface at all. Interactive controls sit at z-20, above this. */}
			<Link
				aria-label={`open ${workflow.name}`}
				className="absolute inset-0 z-10 rounded-[10px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				params={{ org, repo: repoName, workflowId: workflow.id }}
				to="/$org/$repo/workflows/$workflowId"
			/>
			{/* HEADER — name + toggle/actions */}
			<div className="relative flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2 px-3 py-1.5">
				{renaming ? (
					<form
						className="relative z-20 flex flex-1 items-center gap-2"
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
				<div className="relative z-20 flex shrink-0 items-center gap-1">
					<Switch
						aria-label={`${queuedEnabled ? "disable" : "enable"} ${workflow.name}`}
						checked={queuedEnabled}
						disabled={!isAdmin}
						onCheckedChange={setQueuedEnabled}
						tone="accent"
					/>
					{isAdmin ? (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										aria-label={`actions for ${workflow.name}`}
										className="size-7"
										size="icon"
										variant="ghost"
									/>
								}
							>
								<HugeiconsIcon icon={MoreVerticalIcon} size={16} />
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
			{/* BODY — trigger + timestamp. FILLED: an opaque surface-1 well that
			    covers the card-wide dither, so the texture only reads in the header
			    band and the 2px gutters around this well. */}
			<div className="relative flex flex-1 flex-col gap-1 rounded-md border border-border bg-surface-1 px-2 py-1">
				<p className="truncate text-muted-foreground text-xs">
					{triggerSummary(workflow.triggerKinds)} · {workflow.nodeCount}{" "}
					{workflow.nodeCount === 1 ? "node" : "nodes"}
				</p>
				<p className="text-muted-foreground text-xs">
					updated {formatRelativeTime(workflow.updatedAt)}
				</p>
			</div>

			{confirmState === "confirm" ? (
				<div className="relative z-20 flex flex-col gap-2 border-t bg-destructive/5 p-4">
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
							delete workflow
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
		</div>
	);
}
