import {
	FORGE_BY_ID,
	type Forge,
	forgeEvaluates,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { type ReactNode, useId, useState } from "react";
import { HistoryBackControl } from "#/components/common/history-back-control";
import { CopyWorkflowButton } from "#/components/workflows/editor/copy-workflow-button";
import type { Problem } from "#/components/workflows/editor/node-issues";
import { Edit, Icon, More } from "#/design-system/icon";
import { Badge } from "#/design-system/ui/badge";
import { Button } from "#/design-system/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/design-system/ui/dropdown-menu";
import { Input } from "#/design-system/ui/input";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/design-system/ui/segmented-control";
import { toast } from "#/design-system/ui/toast";
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
	forge: Forge;
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
	leading?: ReactNode;
	actions?: ReactNode;
	note?: string;
}

export function EditorHeader({
	forge,
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
	leading,
	actions,
	note,
}: EditorHeaderProps) {
	const [renaming, setRenaming] = useState(false);
	const protectionAvailable = forgeEvaluates(forge);
	const protectionReasonId = useId();
	const enableUnavailable = !enabled && !protectionAvailable;

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
		if (!protectionAvailable) return;
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
			<DropdownMenuItem
				aria-describedby={enableUnavailable ? protectionReasonId : undefined}
				disabled={enableUnavailable}
				key="toggle"
				onClick={handleToggle}
			>
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
		<header
			data-feedback-name="EditorHeader"
			data-layout-role="workflow-editor-header"
		>
			<div data-layout-role="workflow-editor-identity">
				<HistoryBackControl />
				{readOnly ? (
					<span data-layout-role="workflow-editor-name">{name}</span>
				) : renaming ? (
					<Input
						aria-label="Workflow name"
						autoComplete="off"
						autoFocus
						data-layout-role="workflow-editor-name-input"
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
						data-layout-role="workflow-editor-rename"
						onClick={() => setRenaming(true)}
						size="sm"
						variant="ghost"
					>
						<span data-layout-role="workflow-editor-name">{name}</span>
						<Icon icon={Edit} />
					</Button>
				)}
				{enabled ? <Badge>On</Badge> : null}
				{leading}
			</div>
			<div data-layout-role="workflow-editor-controls">
				<SegmentedControl
					aria-label="Workflow view"
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
					<span data-layout-role="workflow-editor-copy">
						<CopyWorkflowButton
							customRules={customRules}
							definition={definition}
						/>
					</span>
				) : null}
				{menuItems.length > 0 ? (
					<DropdownMenu>
						<DropdownMenuTrigger
							data-layout-role="workflow-editor-mobile-menu"
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
				{actions ? (
					actions
				) : readOnly ? (
					<Badge variant="outline">Read only</Badge>
				) : (
					<>
						{view === "canvas" ? (
							<Button
								data-layout-role="workflow-editor-desktop-action"
								disabled={zeroNodes}
								onClick={onArrange}
								size="sm"
								variant="ghost"
							>
								Auto-arrange
							</Button>
						) : null}
						<Button
							aria-describedby={
								enableUnavailable ? protectionReasonId : undefined
							}
							data-layout-role="workflow-editor-desktop-action"
							disabled={enableUnavailable}
							onClick={handleToggle}
							pending={toggling}
							size="sm"
							variant="secondary"
						>
							{enabled ? "Turn off workflow" : "Turn on workflow"}
						</Button>
						{zeroNodes ? (
							<span data-layout-role="workflow-editor-save-hint" id="save-hint">
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
			{note ? <p data-layout-role="workflow-editor-note">{note}</p> : null}
			{protectionAvailable ? null : (
				<p
					data-layout-role="workflow-editor-protection-note"
					id={protectionReasonId}
				>
					{FORGE_BY_ID[forge].label} protection is unavailable. Checks aren't
					available yet.
				</p>
			)}
		</header>
	);
}
