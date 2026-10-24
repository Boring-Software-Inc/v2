import { Link } from "@tanstack/react-router";
import type { WorkflowDefinition } from "@tripwire/contracts";
import { useState } from "react";
import { ArrowLeft, Edit, Icon, More } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import { Input } from "#/components/glaze/ui/input";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { toast } from "#/components/glaze/ui/toast";
import { CopyWorkflowButton } from "#/components/workflows/editor/copy-workflow-button";
import type { Problem } from "#/components/workflows/editor/node-issues";
import { controlHeight } from "#/lib/glaze/utils";
import {
	WORKFLOW_EDITOR_VIEWS,
	type WorkflowEditorView,
} from "#/lib/workflow-editor-search";
import {
	type CustomRuleDisplay,
	workflowToMarkdown,
} from "#/lib/workflow-markdown";

/**
 * Slim editor header — back link, inline-editable name, enabled badge +
 * enable/disable, save. Enabling with live errors never hits the server:
 * the button opens the Problems list instead.
 */

export interface EditorHeaderProps {
	org: string;
	repo: string;
	name: string;
	/** The loaded (secret-redacted) definition — for the copy-markdown action. */
	definition: WorkflowDefinition;
	/** Repo custom rules resolved to name + sentence, for the markdown copy. */
	customRules: readonly CustomRuleDisplay[];
	enabled: boolean;
	readOnly: boolean;
	dirty: boolean;
	saving: boolean;
	toggling: boolean;
	zeroNodes: boolean;
	blockers: readonly Problem[];
	view: WorkflowEditorView;
	onViewChange: (view: WorkflowEditorView) => void;
	onSave: () => void;
	onArrange: () => void;
	onShowProblems: () => void;
	onRename: (name: string) => Promise<{ ok: boolean; error?: string }>;
	onSetEnabled: (enabled: boolean) => void;
}

export function EditorHeader({
	org,
	repo,
	name,
	definition,
	customRules,
	enabled,
	readOnly,
	dirty,
	saving,
	toggling,
	zeroNodes,
	blockers,
	view,
	onViewChange,
	onSave,
	onArrange,
	onRename,
	onSetEnabled,
	onShowProblems,
}: EditorHeaderProps) {
	const [renaming, setRenaming] = useState(false);

	const commitName = async (next: string) => {
		const trimmed = next.trim();
		if (trimmed === "" || trimmed === name) {
			return;
		}
		const result = await onRename(trimmed).catch(() => ({
			ok: false,
			error:
				"Tripwire could not reach the server, so the name did not change. Try again.",
		}));
		if (!result.ok) {
			toast.fail(
				result.error ?? "Tripwire could not rename the workflow. Try again.",
			);
		}
	};

	const handleToggle = () => {
		if (enabled) {
			onSetEnabled(false);
			return;
		}
		if (blockers.length > 0) {
			onShowProblems();
			return;
		}
		onSetEnabled(true);
	};

	const copyMarkdown = async () => {
		try {
			await navigator.clipboard.writeText(
				workflowToMarkdown(definition, customRules),
			);
			toast.success("Copied the workflow as Markdown");
		} catch {
			toast.fail("Tripwire could not copy the workflow. Try again.");
		}
	};

	const menuItems = [
		readOnly ? null : (
			<DropdownMenuItem key="toggle" onClick={handleToggle}>
				{enabled ? "Turn off workflow" : "Turn on workflow"}
			</DropdownMenuItem>
		),
		readOnly || view !== "canvas" ? null : (
			<DropdownMenuItem disabled={zeroNodes} key="arrange" onClick={onArrange}>
				Auto-arrange
			</DropdownMenuItem>
		),
		view === "canvas" ? (
			<DropdownMenuItem key="markdown" onClick={copyMarkdown}>
				Copy as Markdown
			</DropdownMenuItem>
		) : null,
	].filter((item) => item !== null);

	return (
		<header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-line-faint border-b px-3 py-2">
			<div className="flex min-w-0 flex-1 items-center gap-2 max-md:basis-full">
				<Button
					nativeButton={false}
					render={
						<Link
							activeOptions={{ exact: true }}
							params={{ org, repo }}
							to="/$org/$repo/workflows"
						/>
					}
					size="sm"
					variant="ghost"
				>
					<Icon icon={ArrowLeft} />
					<span className="max-md:sr-only">Workflows</span>
				</Button>
				{readOnly ? (
					<span className="min-w-0 truncate type-label">{name}</span>
				) : renaming ? (
					<Input
						aria-label="Workflow name"
						autoComplete="off"
						autoFocus
						className="w-56 min-w-0"
						defaultValue={name}
						key={name}
						onBlur={(event) => {
							setRenaming(false);
							commitName(event.target.value);
						}}
						onFocus={(event) => event.currentTarget.select()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							}
							if (event.key === "Escape") {
								event.currentTarget.value = name;
								event.currentTarget.blur();
							}
						}}
						size="sm"
					/>
				) : (
					<Button
						aria-label={`Rename ${name}`}
						className="min-w-0 max-w-56 justify-start max-md:max-w-full"
						onClick={() => setRenaming(true)}
						size="sm"
						variant="ghost"
					>
						<span className="min-w-0 truncate type-label">{name}</span>
						<Icon className="text-text-3" icon={Edit} />
					</Button>
				)}
				{enabled ? <Badge>On</Badge> : null}
			</div>
			<div className="ms-auto flex min-w-0 items-center gap-2 max-md:w-full">
				<SegmentedControl
					aria-label="Workflow view"
					className={controlHeight.sm}
					onValueChange={(next) => {
						const picked = WORKFLOW_EDITOR_VIEWS.find((v) => v === next);
						if (picked) {
							onViewChange(picked);
						}
					}}
					value={view}
				>
					<SegmentedControlItem value="canvas">Canvas</SegmentedControlItem>
					<SegmentedControlItem value="code">Code</SegmentedControlItem>
				</SegmentedControl>
				{view === "canvas" ? (
					<span className="max-md:hidden">
						<CopyWorkflowButton
							customRules={customRules}
							definition={definition}
						/>
					</span>
				) : null}
				{menuItems.length > 0 ? (
					<DropdownMenu>
						<DropdownMenuTrigger
							className="ms-auto md:hidden"
							render={
								<Button
									aria-label="More workflow actions"
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<Icon icon={More} />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" size="sm">
							{menuItems}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
				{readOnly ? (
					<Badge variant="outline">Read only</Badge>
				) : (
					<>
						{view === "canvas" ? (
							<Button
								className="max-md:hidden"
								disabled={zeroNodes}
								onClick={onArrange}
								size="sm"
								variant="ghost"
							>
								Auto-arrange
							</Button>
						) : null}
						<Button
							className="max-md:hidden"
							onClick={handleToggle}
							pending={toggling}
							size="sm"
							variant="secondary"
						>
							{enabled ? "Turn off workflow" : "Turn on workflow"}
						</Button>
						{zeroNodes ? (
							<span
								className="type-caption text-text-2 max-md:hidden"
								id="save-hint"
							>
								Add a step to save
							</span>
						) : null}
						<Button
							aria-describedby={zeroNodes ? "save-hint" : undefined}
							disabled={!dirty || zeroNodes}
							onClick={onSave}
							pending={saving}
							pendingLabel="Saving"
							size="sm"
						>
							Save workflow
						</Button>
					</>
				)}
			</div>
		</header>
	);
}
