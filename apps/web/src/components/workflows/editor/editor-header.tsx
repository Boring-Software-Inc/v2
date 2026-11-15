import {
	FORGE_BY_ID,
	type Forge,
	forgeEvaluates,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import { Button, IconButton } from "@tripwire/ui/button";
import { Input } from "@tripwire/ui/field";
import { Edit, Icon, More } from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { notify } from "@tripwire/ui/toast";
import { type ReactNode, useId, useState } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import { HistoryBackControl } from "#/components/common/history-back-control";
import { CopyWorkflowButton } from "#/components/workflows/editor/copy-workflow-button";
import type { Problem } from "#/components/workflows/editor/node-issues";
import {
	WORKFLOW_EDITOR_VIEWS,
	type WorkflowEditorView,
} from "#/lib/workflow-editor-search";
import {
	type CustomRuleDisplay,
	workflowToMarkdown,
} from "#/lib/workflow-markdown";
import "./editor-header.css";

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
	const [turningOff, setTurningOff] = useState(false);
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
			notify.show(
				{
					title:
						result.error ??
						"Tripwire could not rename the workflow. Try again.",
				},
				"error",
			);
		}
	};

	const handleToggle = () => {
		if (enabled) {
			setTurningOff(true);
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
			notify.show({ title: "Copied the workflow as Markdown" }, "success");
		} catch {
			notify.show(
				{ title: "Tripwire could not copy the workflow. Try again." },
				"error",
			);
		}
	};

	const menuItems: MenuEntry[] = [];
	if (!readOnly) {
		menuItems.push({
			disabled: enableUnavailable,
			label: enabled ? "Turn off workflow" : "Turn on workflow",
			onAction: handleToggle,
			value: "toggle",
		});
	}
	if (!(readOnly || view !== "canvas")) {
		menuItems.push({
			disabled: zeroNodes,
			label: "Auto-arrange",
			onAction: onArrange,
			value: "arrange",
		});
	}
	if (view === "canvas") {
		menuItems.push({
			label: "Copy as Markdown",
			onAction: copyMarkdown,
			value: "markdown",
		});
	}

	return (
		<>
			<header
				data-feedback-name="EditorHeader"
				data-layout-role="workflow-editor-header"
			>
				<div data-layout-role="workflow-editor-identity">
					<HistoryBackControl />
					{readOnly ? (
						<span data-layout-role="workflow-editor-name">{name}</span>
					) : renaming ? (
						<span data-layout-role="workflow-editor-name-input">
							<Input
								ariaLabel="Workflow name"
								autoComplete="off"
								autoFocus
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
							/>
						</span>
					) : (
						<span data-layout-role="workflow-editor-rename">
							<Button
								ariaLabel={`Rename ${name}`}
								onAction={() => setRenaming(true)}
								size="small"
								variant="ghost"
							>
								<span data-layout-role="workflow-editor-name">{name}</span>
								<Icon icon={Edit} />
							</Button>
						</span>
					)}
					{enabled ? <Badge>On</Badge> : null}
					{leading}
				</div>
				<div data-layout-role="workflow-editor-controls">
					<SegmentedControl
						ariaLabel="Workflow view"
						onValueChange={(next) => {
							const picked = WORKFLOW_EDITOR_VIEWS.find((v) => v === next);
							if (picked) {
								onViewChange(picked);
							}
						}}
						options={[
							{ label: "Canvas", value: "canvas" },
							{ label: "Code", value: "code" },
						]}
						value={view}
					/>
					{view === "canvas" ? (
						<span data-layout-role="workflow-editor-copy">
							<CopyWorkflowButton
								customRules={customRules}
								definition={definition}
							/>
						</span>
					) : null}
					{menuItems.length > 0 ? (
						<span data-layout-role="workflow-editor-mobile-menu">
							<Menu
								align="end"
								ariaLabel="More workflow actions"
								items={menuItems}
								trigger={
									<IconButton
										label="More workflow actions"
										icon={<Icon icon={More} />}
										size="small"
										variant="ghost"
									/>
								}
							/>
						</span>
					) : null}
					{actions ? (
						actions
					) : readOnly ? (
						<Badge variant="outline">Read only</Badge>
					) : (
						<>
							{view === "canvas" ? (
								<span data-layout-role="workflow-editor-desktop-action">
									<Button
										disabled={zeroNodes}
										onAction={onArrange}
										size="small"
										variant="ghost"
									>
										Auto-arrange
									</Button>
								</span>
							) : null}
							<span data-layout-role="workflow-editor-desktop-action">
								{enabled ? (
									<Button
										confirmation={{
											confirmLabel: "Turn off workflow",
											description:
												"Tripwire will stop evaluating this workflow until it is turned on again.",
											title: "Turn off this workflow?",
										}}
										disabled={enableUnavailable}
										onAction={handleToggle}
										pending={toggling}
										reservePendingWidth
										size="small"
										variant="destructive"
									>
										Turn off workflow
									</Button>
								) : (
									<Button
										disabled={enableUnavailable}
										onAction={handleToggle}
										pending={toggling}
										reservePendingWidth
										size="small"
										variant="secondary"
									>
										Turn on workflow
									</Button>
								)}
							</span>
							{zeroNodes ? (
								<span
									data-layout-role="workflow-editor-save-hint"
									id="save-hint"
								>
									Add a step to save
								</span>
							) : null}
							<Button
								aria-describedby={zeroNodes ? "save-hint" : undefined}
								disabled={!dirty || zeroNodes}
								onAction={onSave}
								pending={saving}
								pendingLabel="Saving"
								reservePendingWidth
								size="small"
								variant="primary"
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
			<ConfirmDestructiveDialog
				confirmLabel="Turn off workflow"
				description={`${name} will stop evaluating new change requests until it is turned on again.`}
				onConfirm={() => {
					onSetEnabled(false);
					return undefined;
				}}
				onOpenChange={setTurningOff}
				open={turningOff}
				pendingLabel="Turning off"
				title={`Turn off ${name}?`}
			/>
		</>
	);
}
