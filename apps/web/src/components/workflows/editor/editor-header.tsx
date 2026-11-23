import { useRouter } from "@tanstack/react-router";
import { FORGE_BY_ID, type Forge, forgeEvaluates } from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import { Input } from "@tripwire/ui/field";
import { ArrowLeft, Edit, Icon } from "@tripwire/ui/icon";
import { notify } from "@tripwire/ui/toast";
import { type ReactNode, useState } from "react";
import { useCanGoBack } from "#/components/common/history-back-control";

export interface EditorHeaderProps {
	forge: Forge;
	name: string;
	readOnly: boolean;
	dirty: boolean;
	saving: boolean;
	zeroNodes: boolean;
	onSave: () => void;
	onRename: (name: string) => Promise<{ ok: boolean; error?: string }>;
	leading?: ReactNode;
	actions?: ReactNode;
	note?: string;
}

function WorkflowBackButton() {
	const router = useRouter();
	const canGoBack = useCanGoBack();

	if (!canGoBack) return null;

	return (
		<Button
			ariaLabel="Back to workflows"
			data-layout-role="workflow-editor-back"
			onAction={() => router.history.back()}
			size="small"
			variant="secondary"
		>
			<Icon icon={ArrowLeft} />
			Back
		</Button>
	);
}

export function EditorHeader({
	forge,
	name,
	readOnly,
	dirty,
	saving,
	zeroNodes,
	onSave,
	onRename,
	leading,
	actions,
	note,
}: EditorHeaderProps) {
	const [renaming, setRenaming] = useState(false);
	const protectionAvailable = forgeEvaluates(forge);

	const commitName = async (next: string) => {
		const trimmed = next.trim();
		if (trimmed === "" || trimmed === name) return;
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

	return (
		<header
			data-feedback-name="EditorHeader"
			data-layout-role="workflow-editor-header"
		>
			<div data-layout-role="workflow-editor-identity">
				<WorkflowBackButton />
				{readOnly ? (
					<span data-layout-role="workflow-editor-name">{name}</span>
				) : renaming ? (
					<Input
						ariaLabel="Workflow name"
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
							if (event.key === "Enter") event.currentTarget.blur();
							if (event.key === "Escape") {
								event.currentTarget.value = name;
								event.currentTarget.blur();
							}
						}}
					/>
				) : (
					<Button
						ariaLabel={`Rename ${name}`}
						data-layout-role="workflow-editor-rename"
						onAction={() => setRenaming(true)}
						size="small"
						variant="ghost"
					>
						<span data-layout-role="workflow-editor-name">{name}</span>
						<Icon icon={Edit} />
					</Button>
				)}
				{leading}
			</div>
			<div data-layout-role="workflow-editor-controls">
				{actions ? (
					actions
				) : readOnly ? (
					<Badge variant="outline">Read only</Badge>
				) : (
					<>
						{zeroNodes ? (
							<span data-layout-role="workflow-editor-save-hint" id="save-hint">
								Add a step to save
							</span>
						) : null}
						<Button
							describedBy={zeroNodes ? "save-hint" : undefined}
							disabled={!dirty || zeroNodes}
							onAction={onSave}
							pending={saving}
							pendingLabel="Saving"
							size="small"
						>
							Save workflow
						</Button>
					</>
				)}
			</div>
			{note ? <p data-layout-role="workflow-editor-note">{note}</p> : null}
			{protectionAvailable ? null : (
				<p data-layout-role="workflow-editor-protection-note">
					{FORGE_BY_ID[forge].label} protection is unavailable. Checks aren't
					available yet.
				</p>
			)}
		</header>
	);
}
