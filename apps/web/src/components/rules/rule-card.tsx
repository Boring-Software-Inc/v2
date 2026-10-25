import { Link } from "@tanstack/react-router";
import { ruleUiSchema, WORKFLOW_STATE_LABELS } from "@tripwire/contracts";
import { useId, useState } from "react";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { Icon, More } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardFooter } from "#/components/glaze/ui/card";
import { Sparkline } from "#/components/glaze/ui/chart";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuLinkItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import { Panel } from "#/components/glaze/ui/panel";
import {
	RULE_CARD_CLASS,
	RULE_FOOTER_CLASS,
	RULE_HEADER_CLASS,
	RULE_PANEL_CLASS,
	RULE_SENTENCE_CLASS,
} from "#/components/rules/rule-card-frame";
import { ParamSentence } from "#/components/rules-params/param-sentence";
import { useSaveQueue, useSaveQueueField } from "#/components/save-queue";
import { cn } from "#/lib/glaze/utils";
import type { RuleConfigView } from "#/lib/rules.functions";

export function RuleCard({
	org,
	repo,
	rule,
	canEdit,
	onDelete,
}: {
	org: string;
	repo: string;
	rule: RuleConfigView;
	canEdit: boolean;
	onDelete?: (ruleId: string) => Promise<void>;
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const { valueFor, setField, pending } = useSaveQueue();
	const queuedId = useId();
	const queued = Object.keys(pending).some((key) =>
		key.startsWith(`${rule.ruleId}:`),
	);
	const [queuedEnabled, setEnabled] = useSaveQueueField<boolean | undefined>(
		`${rule.ruleId}:enabled`,
	);
	const enabled = queuedEnabled ?? rule.enabled;
	const [upgradeQueued, setUpgradeQueued] = useSaveQueueField<
		boolean | undefined
	>(`${rule.ruleId}:upgrade`);

	const hasTrend = rule.trend.some((n) => n > 0);
	const standalone = rule.management === "standalone";
	const forgeBlocked = rule.forgeBlockReason !== null;
	const unavailable = rule.unavailableReason !== null;
	const offering =
		rule.optIn && !enabled && standalone && !forgeBlocked && !unavailable;
	const off = standalone && (!enabled || forgeBlocked);
	const params = ruleUiSchema(rule.ruleId)?.params ?? [];
	const showParams = params.length > 0 && !offering;

	const asObject = (c: unknown): Record<string, unknown> =>
		typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};

	const effectiveConfig: Record<string, unknown> = { ...asObject(rule.config) };
	for (const param of params) {
		const pending = valueFor(`${rule.ruleId}:param:${param.key}`);
		if (pending !== undefined) {
			effectiveConfig[param.key] = pending;
		}
	}

	const deletable = rule.source === "custom" && canEdit && onDelete;
	const deleteBlocked = deletable && rule.blockingWorkflows.length > 0;

	const verb = off ? "Install" : "Uninstall";
	const control = standalone ? (
		<Button
			aria-describedby={queuedId}
			aria-label={`${verb} ${rule.name}`}
			disabled={!canEdit || forgeBlocked || (unavailable && off)}
			onClick={() => setEnabled(!enabled)}
			size="sm"
			variant="secondary"
		>
			{verb}
		</Button>
	) : null;

	const activity = forgeBlocked ? (
		<Badge
			title="This forge does not expose what this rule needs"
			variant="warn"
		>
			{rule.forgeBlockReason}
		</Badge>
	) : unavailable ? (
		<span className="flex items-center gap-2">
			<Badge variant="warn">
				{off ? "Can't install" : WORKFLOW_STATE_LABELS["cant-run"]}
			</Badge>
			<span>{rule.unavailableReason}</span>
		</span>
	) : off ? (
		<span>Not installed</span>
	) : rule.matches24h > 0 ? (
		<span className="flex items-center gap-2">
			{hasTrend ? (
				<Sparkline
					className="w-16 text-text-3"
					data={rule.trend}
					end={false}
					label={`${rule.name} matches per hour, last 24 hours`}
					size="sm"
				/>
			) : null}
			<span className="flex items-baseline gap-1">
				<span className="type-label text-text-1 tabular-nums">
					{rule.matches24h}
				</span>
				<span>{rule.matches24h === 1 ? "match" : "matches"}, last 24 h</span>
			</span>
		</span>
	) : (
		<span>No matches, last 24 h</span>
	);

	return (
		<Card
			className={RULE_CARD_CLASS}
			data-off={off ? "" : undefined}
			data-queued={queued ? "" : undefined}
		>
			<span aria-live="polite" className="sr-only" id={queuedId}>
				{queued ? "Change queued. Save to apply it." : ""}
			</span>
			<Panel className={RULE_PANEL_CLASS}>
				<div className={RULE_HEADER_CLASS}>
					<h2
						className={cn(
							"min-w-0 truncate type-label-lg",
							off ? "text-text-2" : "text-text-1",
						)}
						title={rule.name}
					>
						{rule.name}
					</h2>
					{rule.source === "custom" ? (
						<Badge className="shrink-0" variant="outline">
							Custom
						</Badge>
					) : null}
					<span className="ms-auto flex shrink-0 items-center gap-1">
						{deletable ? (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											aria-label={`Actions for ${rule.name}`}
											size="icon-sm"
											variant="ghost"
										/>
									}
								>
									<Icon icon={More} />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" size="sm">
									{deleteBlocked ? (
										<>
											<DropdownMenuGroup>
												<DropdownMenuLabel>In use by</DropdownMenuLabel>
												{rule.blockingWorkflows.map((wf) => (
													<DropdownMenuLinkItem
														key={wf.id}
														render={
															<Link
																params={{ org, repo, workflowId: wf.id }}
																to="/$org/$repo/workflows/$workflowId"
															/>
														}
													>
														{wf.name}
													</DropdownMenuLinkItem>
												))}
											</DropdownMenuGroup>
											<DropdownMenuSeparator />
										</>
									) : null}
									<DropdownMenuItem
										disabled={Boolean(deleteBlocked)}
										onClick={() => setConfirmingDelete(true)}
										title={
											deleteBlocked
												? "Remove this rule from its workflows before you delete it"
												: undefined
										}
										variant="destructive"
									>
										Delete rule
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{control}
					</span>
				</div>

				{showParams ? (
					<ParamSentence
						canEdit={canEdit && standalone && !forgeBlocked}
						className={RULE_SENTENCE_CLASS}
						config={effectiveConfig}
						onSaveParam={(key, value) =>
							setField(`${rule.ruleId}:param:${key}`, value)
						}
						ruleId={rule.ruleId}
					/>
				) : (
					<p className={RULE_SENTENCE_CLASS} title={rule.blurb}>
						{rule.blurb}
					</p>
				)}

				{rule.held && standalone ? (
					<div className="flex flex-wrap items-center gap-2 pt-1.5">
						<Badge variant="warn">New version waiting</Badge>
						<span className="type-body-sm text-text-2">
							{rule.changeNote ? `${rule.changeNote}. ` : ""}Your saved settings
							do not carry over to it, so this rule keeps running the old
							version until you move it.
						</span>
						<Button
							aria-pressed={upgradeQueued === true}
							disabled={!canEdit}
							onClick={() => setUpgradeQueued(upgradeQueued !== true)}
							size="sm"
							variant="secondary"
						>
							{upgradeQueued === true
								? "Moves when you save"
								: "Move to new version"}
						</Button>
					</div>
				) : null}
			</Panel>
			<CardFooter className={RULE_FOOTER_CLASS}>{activity}</CardFooter>
			<ConfirmDeleteDialog
				actionLabel="Delete rule"
				description="Its past matches stay in Activity."
				onConfirm={() => onDelete?.(rule.ruleId)}
				onOpenChange={setConfirmingDelete}
				open={Boolean(deletable) && confirmingDelete}
				title={`Delete ${rule.name}?`}
			/>
		</Card>
	);
}
