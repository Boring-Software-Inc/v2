import {
	type JsonValue,
	ruleUiSchema,
	WORKFLOW_STATE_LABELS,
} from "@tripwire/contracts";
import { useId } from "react";
import {
	RULE_HEADER_CLASS,
	RULE_SENTENCE_CLASS,
} from "#/components/rules/rule-card-frame";
import { RuleSettingsMenu } from "#/components/rules/rule-settings-menu";
import { RuleUsedIn } from "#/components/rules/rule-used-in";
import { ParamSentence } from "#/components/rules-params/param-sentence";
import { useSaveQueue, useSaveQueueField } from "#/components/save-queue";

type RuleConfigValues = Record<string, JsonValue>;

import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import { Card, CardFooter } from "@tripwire/ui/card";
import type { MenuEntry } from "@tripwire/ui/menu";
import { Panel } from "@tripwire/ui/panel";
import { Sparkline } from "#/components/common/chart";
import type { RuleConfigView } from "#/lib/rules.functions";
import { cn } from "#/lib/utils";

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

	const asObject = (config: JsonValue): Record<string, JsonValue> =>
		config === null || Array.isArray(config) || Object(config) !== config
			? {}
			: (config as Record<string, JsonValue>);

	const effectiveConfig: RuleConfigValues = {
		...asObject(rule.config),
	};
	for (const param of params) {
		const pending = valueFor(`${rule.ruleId}:param:${param.key}`);
		if (pending !== undefined) {
			effectiveConfig[param.key] = pending;
		}
	}

	const deletable = rule.source === "custom" && canEdit && onDelete;
	const showSettings =
		Boolean(org && repo) && (rule.enabled || !standalone) && !forgeBlocked;
	const deleteBlocked = deletable && rule.blockingWorkflows.length > 0;
	const settingsItems: MenuEntry[] = deletable
		? [
				...(deleteBlocked
					? [
							{
								items: rule.blockingWorkflows.map((workflow) => ({
									href: `/${org}/${repo}/workflows/${workflow.id}`,
									label: workflow.name,
									type: "link" as const,
									value: `workflow:${workflow.id}`,
								})),
								label: "In use by",
								type: "group" as const,
								value: "blocking-workflows",
							},
							{ type: "separator" as const, value: "delete-rule-separator" },
						]
					: []),
				{
					confirmation: {
						confirmLabel: "Delete rule",
						description: `${rule.name} and its configuration will be permanently deleted.`,
						title: `Delete ${rule.name}?`,
					},
					disabled: Boolean(deleteBlocked),
					label: "Delete rule",
					onAction: () => onDelete?.(rule.ruleId),
					tone: "destructive",
					value: "delete-rule",
				},
			]
		: [];

	const verb = off ? "Install" : "Uninstall";
	const control =
		standalone && enabled ? (
			<Button
				aria-describedby={queuedId}
				ariaLabel={`Uninstall ${rule.name}`}
				confirmation={{
					confirmLabel: "Uninstall rule",
					description: `${rule.name} will stop evaluating new change requests after you save this change.`,
					title: `Uninstall ${rule.name}?`,
				}}
				disabled={!canEdit || forgeBlocked}
				onAction={() => setEnabled(false)}
				size="small"
				variant="destructive"
			>
				Uninstall
			</Button>
		) : standalone ? (
			<Button
				aria-describedby={queuedId}
				ariaLabel={`${verb} ${rule.name}`}
				disabled={!canEdit || forgeBlocked || (unavailable && off)}
				onAction={() => setEnabled(true)}
				size="small"
				variant="secondary"
			>
				{verb}
			</Button>
		) : rule.usedIn.length > 0 ? (
			<RuleUsedIn
				org={org}
				repo={repo}
				ruleName={rule.name}
				workflows={rule.usedIn}
			/>
		) : null;

	const activity = forgeBlocked ? (
		<Badge
			title="This forge does not expose what this rule needs"
			tone="warning"
		>
			{rule.forgeBlockReason}
		</Badge>
	) : unavailable ? (
		<span className="flex items-center gap-2">
			<Badge tone="warning">
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
					data-layout-role="rule-activity-trend"
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
			data-layout-role="rule-card-frame"
			data-off={off ? "" : undefined}
			data-queued={queued ? "" : undefined}
		>
			<span aria-live="polite" className="sr-only" id={queuedId}>
				{queued ? "Change queued. Save to apply it." : ""}
			</span>
			<Panel data-layout-role="rule-card-panel">
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
						{control}
						{(showSettings || deletable) && (
							<RuleSettingsMenu
								items={settingsItems}
								name={rule.name}
								org={org}
								repo={repo}
								ruleId={rule.ruleId}
								showSettings={showSettings}
							/>
						)}
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
						settingsScope={org && repo ? { org, repo } : undefined}
					/>
				) : (
					<p className={RULE_SENTENCE_CLASS} title={rule.blurb}>
						{rule.blurb}
					</p>
				)}

				{rule.held && standalone ? (
					<div className="flex flex-wrap items-center gap-2 pt-1.5">
						<Badge tone="warning">New version waiting</Badge>
						<span className="type-body-sm text-text-2">
							{rule.changeNote ? `${rule.changeNote}. ` : ""}Your saved settings
							do not carry over to it, so this rule keeps running the old
							version until you move it.
						</span>
						<Button
							aria-pressed={upgradeQueued === true}
							disabled={!canEdit}
							onAction={() => setUpgradeQueued(upgradeQueued !== true)}
							size="small"
							variant="secondary"
						>
							{upgradeQueued === true
								? "Moves when you save"
								: "Move to new version"}
						</Button>
					</div>
				) : null}
			</Panel>
			<CardFooter data-layout-role="rule-card-footer">{activity}</CardFooter>
		</Card>
	);
}
