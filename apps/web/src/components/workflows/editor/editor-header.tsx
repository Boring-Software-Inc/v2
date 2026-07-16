import { Link } from "@tanstack/react-router";
import type { ValidationIssue } from "@tripwire/contracts";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "#/lib/utils";

/**
 * Slim editor header — back link, inline-editable name, enabled pill +
 * enable/disable, save. Enabling with live issues never hits the server:
 * the button opens the why-not list instead.
 */

export interface EditorHeaderProps {
	org: string;
	repo: string;
	name: string;
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

	const commitName = async (next: string) => {
		const trimmed = next.trim();
		if (trimmed === "" || trimmed === name) {
			return;
		}
		const result = await onRename(trimmed);
		if (!result.ok) {
			toast(result.error ?? "couldn't rename");
		}
	};

	const handleToggle = () => {
		if (enabled) {
			onSetEnabled(false);
			return;
		}
		if (blockers.length > 0) {
			setWhyOpen((value) => !value);
			return;
		}
		onSetEnabled(true);
	};

	return (
		<header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
			<Link
				className="shrink-0 text-muted-foreground text-xs transition-colors hover:text-foreground"
				params={{ org, repo }}
				to="/$org/$repo/workflows"
			>
				← workflows
			</Link>
			{readOnly ? (
				<span className="truncate font-medium text-sm">{name}</span>
			) : (
				<input
					aria-label="workflow name"
					className="min-w-0 max-w-72 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-medium text-sm transition-colors hover:border-border focus:border-border focus:outline-none"
					defaultValue={name}
					key={name}
					onBlur={(event) => commitName(event.target.value)}
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
			)}
			<span
				className={cn(
					"shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px]",
					enabled
						? "bg-brand/10 text-brand"
						: "bg-surface-2 text-muted-foreground",
				)}
			>
				{enabled ? "enabled" : "disabled"}
			</span>
			<div className="ml-auto flex shrink-0 items-center gap-2">
				{readOnly ? (
					<span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-[11px] text-muted-foreground">
						read-only
					</span>
				) : (
					<>
						<div className="relative">
							<button
								className="rounded-md border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-surface-1 disabled:opacity-50"
								disabled={toggling}
								onClick={handleToggle}
								type="button"
							>
								{toggling ? "…" : enabled ? "disable" : "enable"}
							</button>
							{whyOpen && !enabled && blockers.length > 0 ? (
								<>
									<button
										aria-label="close"
										className="fixed inset-0 z-20 cursor-default"
										onClick={() => setWhyOpen(false)}
										type="button"
									/>
									<div className="absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border bg-popover p-2 shadow-md">
										<p className="mb-1 px-1 font-medium text-[11px] text-muted-foreground">
											can't enable yet — fix these first
										</p>
										<ul className="flex flex-col gap-0.5">
											{blockers.map((issue) => (
												<li
													className="flex items-start gap-1.5 px-1 py-0.5 text-xs"
													key={`${issue.nodeId ?? issue.edgeId ?? ""}-${issue.message}`}
												>
													<span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-red-500" />
													{issue.message}
												</li>
											))}
										</ul>
									</div>
								</>
							) : null}
						</div>
						<button
							className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
							disabled={saving || !dirty || zeroNodes}
							onClick={onSave}
							title={zeroNodes ? "add a node first" : undefined}
							type="button"
						>
							{saving ? "saving…" : "save"}
						</button>
					</>
				)}
			</div>
		</header>
	);
}
