import type {
	Forge,
	WorkflowDefinition,
	WorkflowNode,
} from "@tripwire/contracts";
import { forgeEvaluates } from "@tripwire/contracts";
import { Button, IconButton } from "@tripwire/ui/button";
import { Code, Copy, Icon, More, Tool, Workflow } from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { Switch } from "@tripwire/ui/switch";
import { notify } from "@tripwire/ui/toast";
import { useId, useState } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import type { Problem } from "#/components/workflows/editor/node-issues";
import {
	WORKFLOW_EDITOR_VIEWS,
	type WorkflowEditorView,
} from "#/lib/workflow-editor-search";
import {
	type CustomRuleDisplay,
	workflowToMarkdown,
} from "#/lib/workflow-markdown";

export interface EditorToolbarProps {
	blockers: readonly Problem[];
	customRules: readonly CustomRuleDisplay[];
	definition: WorkflowDefinition;
	enabled: boolean;
	forge: Forge;
	name: string;
	onArrange: () => void;
	onDuplicateSelected: () => void;
	onOpenToolbox: (trigger: HTMLButtonElement) => void;
	onRemoveSelected: () => void;
	onSetEnabled: (enabled: boolean) => void;
	onShowProblems: () => void;
	onViewChange: (view: WorkflowEditorView) => void;
	readOnly: boolean;
	selectedNode: WorkflowNode | null;
	selectedName: string | null;
	toggling: boolean;
	view: WorkflowEditorView;
	zeroNodes: boolean;
}

export function EditorToolbar({
	blockers,
	customRules,
	definition,
	enabled,
	forge,
	name,
	onArrange,
	onDuplicateSelected,
	onOpenToolbox,
	onRemoveSelected,
	onSetEnabled,
	onShowProblems,
	onViewChange,
	readOnly,
	selectedNode,
	selectedName,
	toggling,
	view,
	zeroNodes,
}: EditorToolbarProps) {
	const [turningOff, setTurningOff] = useState(false);
	const protectionReasonId = useId();
	const enableUnavailable = !enabled && !forgeEvaluates(forge);

	const changeEnabled = (next: boolean) => {
		if (!next) {
			setTurningOff(true);
			return;
		}
		if (enableUnavailable) return;
		if (blockers.length > 0) {
			onShowProblems();
			return;
		}
		onSetEnabled(true);
	};

	const changeView = (next: string | null) => {
		if (!next) return;
		const picked = WORKFLOW_EDITOR_VIEWS.find(
			(candidate) => candidate === next,
		);
		if (picked) onViewChange(picked);
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
	const mobileMenuItems: MenuEntry[] = [
		{
			label: "Copy as Markdown",
			onAction: copyMarkdown,
			value: "copy-markdown",
		},
	];
	if (view === "canvas" && !readOnly) {
		mobileMenuItems.push({
			disabled: zeroNodes,
			label: "Auto-arrange",
			onAction: onArrange,
			value: "auto-arrange",
		});
	}

	return (
		<>
			<div
				data-layout-role="workflow-editor-toolbar"
				data-layout-state={selectedNode ? "selected" : "generic"}
			>
				{selectedNode ? (
					<div aria-label={`${selectedName ?? "Step"} actions`} role="toolbar">
						<span data-layout-role="workflow-editor-selection-label">
							{selectedName ?? "Step"} selected
						</span>
						{readOnly ? null : (
							<span data-layout-role="workflow-editor-toolbar-actions">
								<Button onAction={onDuplicateSelected} size="small">
									Duplicate
								</Button>
								<Button
									confirmation={{
										confirmLabel: "Remove",
										description: `${selectedName ?? "This step"} will be removed from the workflow.`,
										title: `Remove ${selectedName ?? "step"}?`,
									}}
									onAction={onRemoveSelected}
									size="small"
									variant="destructive"
								>
									Remove
								</Button>
							</span>
						)}
					</div>
				) : (
					<div aria-label="Workflow tools" role="toolbar">
						<SegmentedControl
							ariaLabel="Workflow view"
							onValueChange={changeView}
							options={[
								{ label: "Canvas", value: "canvas" },
								{ label: "Code", value: "code" },
							]}
							size="small"
							value={view}
						/>
						{readOnly ? null : (
							<div data-layout-role="workflow-editor-status">
								<span>{enabled ? "Workflow on" : "Workflow off"}</span>
								<Switch
									ariaDescribedBy={
										enableUnavailable ? protectionReasonId : undefined
									}
									ariaLabel={enabled ? "Turn off workflow" : "Turn on workflow"}
									checked={enabled}
									disabled={enableUnavailable}
									onCheckedChange={changeEnabled}
									pending={toggling}
									size="small"
								/>
							</div>
						)}
						<span data-layout-role="workflow-editor-toolbar-actions">
							<Button onAction={copyMarkdown} size="small">
								<Icon icon={Copy} />
								Copy
							</Button>
							{readOnly ? null : (
								<span
									aria-hidden={view === "code" ? true : undefined}
									data-reserved={view === "code" ? "" : undefined}
									tabIndex={view === "code" ? -1 : undefined}
								>
									<Button
										disabled={view === "code" || zeroNodes}
										onAction={view === "canvas" ? onArrange : undefined}
										size="small"
									>
										Auto-arrange
									</Button>
								</span>
							)}
						</span>
					</div>
				)}
			</div>

			{selectedNode ? null : (
				<div data-layout-role="workflow-editor-mobile-dock">
					<Button
						ariaLabel="Open toolbox"
						onAction={() => {
							const trigger = document.activeElement;
							if (trigger instanceof HTMLButtonElement) onOpenToolbox(trigger);
						}}
						size="large"
					>
						<Icon icon={Tool} />
						<span data-layout-role="workflow-mobile-toolbox-label">
							Toolbox
						</span>
					</Button>
					<SegmentedControl
						ariaLabel="Workflow view"
						onValueChange={changeView}
						options={[
							{
								icon: Workflow,
								iconOnly: true,
								label: "Canvas",
								value: "canvas",
							},
							{ icon: Code, iconOnly: true, label: "Code", value: "code" },
						]}
						size="small"
						value={view}
					/>
					{readOnly ? null : (
						<div data-layout-role="workflow-editor-mobile-status">
							<span data-layout-role="workflow-mobile-status-label">
								{enabled ? "On" : "Off"}
							</span>
							<Switch
								ariaLabel={enabled ? "Turn off workflow" : "Turn on workflow"}
								checked={enabled}
								disabled={enableUnavailable}
								onCheckedChange={changeEnabled}
								pending={toggling}
								size="small"
							/>
						</div>
					)}
					<Menu
						align="end"
						ariaLabel="More workflow actions"
						items={mobileMenuItems}
						trigger={
							<IconButton
								icon={<Icon icon={More} />}
								label="More workflow actions"
								size="large"
								variant="ghost"
							/>
						}
					/>
				</div>
			)}

			{enableUnavailable ? (
				<span className="sr-only" id={protectionReasonId}>
					Protection is unavailable for this forge.
				</span>
			) : null}
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
