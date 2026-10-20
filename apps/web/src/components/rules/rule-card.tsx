import { Link } from "@tanstack/react-router";
import { ruleUiSchema } from "@tripwire/contracts";
import { ArrowRight, Icon } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardMeta,
	CardTitle,
} from "#/components/glaze/ui/card";
import { Sparkline } from "#/components/glaze/ui/chart";
import { Switch } from "#/components/glaze/ui/switch";
import { ParamSentence } from "#/components/rules-params/param-sentence";
import { useSaveQueue, useSaveQueueField } from "#/components/save-queue";
import { cn } from "#/lib/glaze/utils";
import type { RuleConfigView } from "#/lib/rules.functions";

const SEVERITY_LABEL: Record<string, string> = {
	low: "Low severity",
	medium: "Medium severity",
	high: "High severity",
};

/**
 * One rule as a header/body/footer card (§9), with per-rule management state
 * (§6 — workflows compose with standalone rules, they never disable them):
 *
 * - standalone — not owned by any enabled workflow: the normal card. Toggle,
 *   inline editing. Its own config runs, workflow or not.
 * - managed — a node in an enabled workflow: no toggle, values read-only (the
 *   NODE's config, what actually runs), footer "edit in workflow". Held prompt
 *   is suppressed (the workflow node, not the rule_config, drives it).
 *
 * Every write goes through the save queue (first live useSaveQueueField
 * consumer): the toggle, the enable offer, every inline param edit, and the
 * held re-confirm all queue; the floating bar commits them as one batch. No
 * direct mutation remains in this card.
 */
export function RuleCard({
	org,
	repo,
	rule,
	canEdit,
	onDelete,
}: {
	/** Org slug from the URL. */
	org: string;
	/** Repo slug from the URL — for the workflow deep-links. */
	repo: string;
	rule: RuleConfigView;
	/** Caller is an org admin — gates the inline config editors (§9). */
	canEdit: boolean;
	/** Custom rules only: remove the rule. Lifecycle, not behavior. */
	onDelete?: (ruleId: string) => void;
}) {
	const { valueFor, setField } = useSaveQueue();
	// Pending-or-saved; managed rules have no queue keys, so fall back to the
	// view (the workflow node's state, read-only anyway).
	const [queuedEnabled, setEnabled] = useSaveQueueField<boolean | undefined>(
		`${rule.ruleId}:enabled`,
	);
	const enabled = queuedEnabled ?? rule.enabled;
	const [upgradeQueued, setUpgradeQueued] = useSaveQueueField<
		boolean | undefined
	>(`${rule.ruleId}:upgrade`);

	const hasTrend = rule.trend.some((n) => n > 0);
	const standalone = rule.management === "standalone";
	/**
	 * The forge cannot feed this rule, so it can never fire here. Treated like a
	 * hard disable rather than a warning: an editable toggle would let you arm
	 * something inert and believe the repo was gated.
	 */
	const forgeBlocked = rule.forgeBlockReason !== null;
	/** An opt-in rule that's off is an OFFER, not a silently-disabled toggle. */
	const offering = rule.optIn && !enabled && standalone && !forgeBlocked;
	const params = ruleUiSchema(rule.ruleId)?.params ?? [];
	const hasParams = params.length > 0;
	/** Show the param sentence (not the blurb) — configurable + not an offer. */
	const showParams = hasParams && !offering;

	const asObject = (c: unknown): Record<string, unknown> =>
		typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};

	// The sentence renders pending-or-saved per param, so queued edits show
	// in place before they commit.
	const effectiveConfig: Record<string, unknown> = { ...asObject(rule.config) };
	for (const param of params) {
		const pending = valueFor(`${rule.ruleId}:param:${param.key}`);
		if (pending !== undefined) {
			effectiveConfig[param.key] = pending;
		}
	}

	const body = showParams ? (
		<ParamSentence
			canEdit={canEdit && standalone && !forgeBlocked}
			config={effectiveConfig}
			onSaveParam={(key, value) =>
				setField(`${rule.ruleId}:param:${key}`, value)
			}
			ruleId={rule.ruleId}
		/>
	) : (
		<p className="type-body-sm text-text-2">{rule.blurb}</p>
	);

	const workflowLink =
		rule.management === "managed" && rule.workflowId ? rule.workflowId : null;
	const deletable = rule.source === "custom" && canEdit && onDelete;
	const deleteBlocked = deletable && rule.blockingWorkflows.length > 0;

	return (
		<Card className="flex h-full flex-col [&>[data-slot=card-panel]]:flex-1">
			<CardHeader>
				<CardTitle className="truncate">{rule.name}</CardTitle>
				<CardDescription className="flex flex-wrap items-center gap-1">
					<Badge variant={enabled && standalone ? "neutral" : "outline"}>
						Block
					</Badge>
					{rule.source === "custom" ? (
						<Badge variant="outline">Custom</Badge>
					) : null}
					{rule.severity ? (
						<Badge variant="outline">
							{SEVERITY_LABEL[rule.severity] ?? rule.severity}
						</Badge>
					) : null}
					{rule.management === "managed" ? (
						<Badge variant="outline">In workflow</Badge>
					) : null}
					{rule.forgeBlockReason ? (
						<Badge
							title="This forge does not expose what this rule needs"
							variant="warn"
						>
							{rule.forgeBlockReason}
						</Badge>
					) : null}
				</CardDescription>
				<CardAction className="gap-3">
					{hasTrend ? (
						<Sparkline
							className="hidden w-16 sm:inline-block"
							data={rule.trend}
							label={`${rule.name} matches per hour, last 24 hours`}
							size="sm"
						/>
					) : null}
					<span className="flex flex-col items-end">
						<span
							className={cn(
								"type-label tabular-nums",
								rule.matches24h > 0 ? "text-fail-text" : "text-text-1",
							)}
						>
							{rule.matches24h}
						</span>
						<span className="type-caption text-text-2">24h</span>
					</span>
					{standalone ? (
						offering ? (
							<Button
								disabled={!canEdit}
								onClick={() => setEnabled(true)}
								size="sm"
							>
								Enable rule
							</Button>
						) : (
							<Switch
								aria-label={
									forgeBlocked
										? `${rule.name}, ${rule.forgeBlockReason}`
										: rule.name
								}
								checked={enabled && !forgeBlocked}
								disabled={!canEdit || forgeBlocked}
								onCheckedChange={setEnabled}
								size="sm"
							/>
						)
					) : null}
				</CardAction>
			</CardHeader>

			<CardContent className="flex-1">
				{body}

				{rule.held && standalone ? (
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="warn">Update held</Badge>
						<span className="type-body-sm text-text-2">
							{rule.changeNote ? `${rule.changeNote}. ` : ""}Your saved settings
							do not carry over. Re-confirm to move to the new version.
						</span>
						<Button
							aria-pressed={upgradeQueued === true}
							disabled={!canEdit}
							onClick={() => setUpgradeQueued(upgradeQueued !== true)}
							size="sm"
							variant="secondary"
						>
							{upgradeQueued === true ? "Queued, save to apply" : "Re-confirm"}
						</Button>
					</div>
				) : null}
			</CardContent>

			{workflowLink || deletable ? (
				<CardFooter>
					{deleteBlocked ? (
						<CardMeta>
							In use by{" "}
							{rule.blockingWorkflows.map((wf, index) => (
								<span key={wf.id}>
									{index > 0 ? ", " : ""}
									<Link
										className="relative text-text-1 hover:underline"
										params={{ org, repo, workflowId: wf.id }}
										to="/$org/$repo/workflows/$workflowId"
									>
										{wf.name}
									</Link>
								</span>
							))}
						</CardMeta>
					) : null}
					{workflowLink ? (
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
					) : null}
					{deletable ? (
						<Button
							disabled={Boolean(deleteBlocked)}
							focusableWhenDisabled={Boolean(deleteBlocked)}
							onClick={() => onDelete?.(rule.ruleId)}
							size="sm"
							title={
								deleteBlocked
									? "Remove this rule from its workflows before deleting"
									: undefined
							}
							variant="secondary"
						>
							Delete rule
						</Button>
					) : null}
				</CardFooter>
			) : null}
		</Card>
	);
}
