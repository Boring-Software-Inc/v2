import { Link } from "@tanstack/react-router";
import type { ValidationIssue, WorkflowDefinition } from "@tripwire/contracts";
import { useState } from "react";
import { ArrowLeft, Edit, Icon } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Input } from "#/components/glaze/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { StatusMark } from "#/components/glaze/ui/status";
import { toast } from "#/components/glaze/ui/toast";
import { CopyWorkflowButton } from "#/components/workflows/editor/copy-workflow-button";
import type { CustomRuleDisplay } from "#/lib/workflow-markdown";

/**
 * Slim editor header — back link, inline-editable name, enabled badge +
 * enable/disable, save. Enabling with live issues never hits the server:
 * the button opens the why-not list instead.
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
	blockers: ValidationIssue[];
	onSave: () => void;
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
	onSave,
	onRename,
	onSetEnabled,
}: EditorHeaderProps) {
	const [whyOpen, setWhyOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const blocked = !enabled && blockers.length > 0;

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
			return;
		}
		onSetEnabled(true);
	};

	return (
		<header className="flex shrink-0 flex-wrap items-center gap-2 border-line-faint border-b px-3 py-2">
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
				Workflows
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
					className="min-w-0 max-w-56 justify-start"
					onClick={() => setRenaming(true)}
					size="sm"
					variant="ghost"
				>
					<span className="min-w-0 truncate type-label">{name}</span>
					<Icon className="text-text-3" icon={Edit} />
				</Button>
			)}
			{enabled ? <Badge>On</Badge> : null}
			<div className="ms-auto flex shrink-0 items-center gap-2">
				<CopyWorkflowButton customRules={customRules} definition={definition} />
				{readOnly ? (
					<Badge variant="outline">Read only</Badge>
				) : (
					<>
						<Popover
							onOpenChange={(next) => setWhyOpen(next && blocked)}
							open={whyOpen && blocked}
						>
							<PopoverTrigger
								render={
									<Button
										onClick={handleToggle}
										pending={toggling}
										size="sm"
										variant="secondary"
									/>
								}
							>
								{enabled ? "Turn off workflow" : "Turn on workflow"}
							</PopoverTrigger>
							<PopoverContent align="end">
								<PopoverHeader>
									<PopoverTitle>Fix these to turn the workflow on</PopoverTitle>
								</PopoverHeader>
								<ul className="flex flex-col gap-1">
									{blockers.map((issue) => (
										<li
											className="flex items-start gap-1 type-body-sm"
											key={`${issue.nodeId ?? issue.edgeId ?? ""}-${issue.message}`}
										>
											<StatusMark
												className="mt-0.5"
												label="Issue"
												status="fail"
											/>
											{issue.message}
										</li>
									))}
								</ul>
							</PopoverContent>
						</Popover>
						{zeroNodes ? (
							<span className="type-caption text-text-2" id="save-hint">
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
