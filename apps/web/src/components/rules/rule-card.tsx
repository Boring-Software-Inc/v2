import { Link } from "@tanstack/react-router";
import { ruleUiSchema } from "@tripwire/contracts";
import { useState } from "react";
import { ArrowRight, Blocked, Icon, More } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardFooter } from "#/components/glaze/ui/card";
import { Sparkline } from "#/components/glaze/ui/chart";
import {
	Dialog,
	DialogAction,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
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
import { Switch } from "#/components/glaze/ui/switch";
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

const SEVERITY_LABEL: Record<string, string> = {
	low: "Low severity",
	medium: "Medium severity",
	high: "High severity",
};

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
	const { valueFor, setField } = useSaveQueue();
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
	const offering = rule.optIn && !enabled && standalone && !forgeBlocked;
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

	const workflowLink =
		rule.management === "managed" && rule.workflowId ? rule.workflowId : null;
	const deletable = rule.source === "custom" && canEdit && onDelete;
	const deleteBlocked = deletable && rule.blockingWorkflows.length > 0;

	const control = standalone ? (
		offering ? (
			<Button disabled={!canEdit} onClick={() => setEnabled(true)} size="sm">
				Enable rule
			</Button>
		) : (
			<Switch
				aria-label={
					forgeBlocked ? `${rule.name}, ${rule.forgeBlockReason}` : rule.name
				}
				checked={enabled && !forgeBlocked}
				disabled={!canEdit || forgeBlocked}
				onCheckedChange={setEnabled}
				size="sm"
			/>
		)
	) : workflowLink ? (
		<Button
			nativeButton={false}
			render={
				<Link
					params={{ org, repo, workflowId: workflowLink }}
					to="/$org/$repo/workflows/$workflowId"
				/>
			}
			size="sm"
			variant="secondary"
		>
			Edit in workflow
			<Icon icon={ArrowRight} />
		</Button>
	) : null;

	const activity = forgeBlocked ? (
		<Badge
			title="This forge does not expose what this rule needs"
			variant="warn"
		>
			{rule.forgeBlockReason}
		</Badge>
	) : off ? (
		<span>Off</span>
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
		<Card className={RULE_CARD_CLASS} data-off={off ? "" : undefined}>
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
					{rule.management === "managed" ? (
						<Badge className="shrink-0" variant="outline">
							In workflow
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
			<CardFooter className={RULE_FOOTER_CLASS}>
				<span className="flex items-center gap-1.5">
					<Icon
						className={off ? "text-text-3" : "text-text-2"}
						icon={Blocked}
					/>
					<span className="type-label-sm">Blocks</span>
					{rule.severity ? (
						<span className="ms-1">
							{SEVERITY_LABEL[rule.severity] ?? rule.severity}
						</span>
					) : null}
				</span>
				{activity}
			</CardFooter>
			<Dialog
				onOpenChange={setConfirmingDelete}
				open={Boolean(deletable) && confirmingDelete}
				role="alertdialog"
			>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Delete {rule.name}?</DialogTitle>
						<DialogDescription>
							Tripwire stops checking change requests against this rule. Its
							past matches stay in Activity.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose>Keep rule</DialogClose>
						<DialogAction
							onAction={() => onDelete?.(rule.ruleId)}
							pendingLabel="Deleting"
							variant="destructive"
						>
							Delete rule
						</DialogAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
