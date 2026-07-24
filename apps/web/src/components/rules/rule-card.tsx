import { Link } from "@tanstack/react-router";
import { ruleUiSchema } from "@tripwire/contracts";
import { Sparkline } from "#/components/charts/dither-kit";
import { ParamSentence } from "#/components/rules-params/param-sentence";
import { RawConfigDisclosure } from "#/components/rules-params/raw-config-disclosure";
import { useSaveQueue, useSaveQueueField } from "#/components/save-queue";
import { Dither } from "#/components/ui/dither";
import { Switch } from "#/components/ui/switch";
import type { RuleConfigView } from "#/lib/rules.functions";
import { cn } from "#/lib/utils";

/**
 * One rule as a header/body/footer card (§9), with per-rule management state
 * (§6 — workflows compose with standalone rules, they never disable them):
 *
 * - standalone — not owned by any enabled workflow: the normal card. Toggle,
 *   inline editing, view raw. Its own config runs, workflow or not.
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
	/** An opt-in rule that's off is an OFFER, not a silently-disabled toggle. */
	const offering = rule.optIn && !enabled && standalone;
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
			canEdit={canEdit && standalone}
			config={effectiveConfig}
			onSaveParam={(key, value) =>
				setField(`${rule.ruleId}:param:${key}`, value)
			}
			ruleId={rule.ruleId}
		/>
	) : (
		<p className="text-muted-foreground text-xs leading-relaxed">
			{rule.blurb}
		</p>
	);

	return (
		<div className="flex h-full flex-col overflow-hidden rounded-xl border-[3px] bg-card">
			{/* HEADER — identity + verdict state + activity + toggle. Same
			    surface-1 band on every rule; custom rules add the house dither
			    over it (only here, in this header row), under the content. */}
			<div className="relative isolate flex flex-wrap items-center gap-x-2.5 gap-y-2 overflow-hidden bg-surface-1 px-4 py-2">
				{rule.source === "custom" ? (
					<Dither className="-z-10 opacity-60" speed={1} />
				) : null}
				<span className="font-medium text-sm">{rule.name}</span>
				<span
					className={cn(
						"text-xs",
						enabled && standalone
							? "text-muted-foreground"
							: "text-muted-foreground/50",
					)}
				>
					block
				</span>
				{rule.source === "custom" ? (
					<span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
						custom
					</span>
				) : null}
				{/* Severity (how much a failure weighs) — moved out of the sentence,
				    which now states the requirement only. */}
				{rule.severity ? (
					<span
						className={cn(
							"rounded px-1.5 py-0.5 text-[10px] ring-1",
							rule.severity === "high"
								? "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400"
								: rule.severity === "medium"
									? "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400"
									: "bg-surface-1 text-muted-foreground ring-border",
						)}
					>
						{rule.severity}
					</span>
				) : null}
				{rule.management === "managed" ? (
					<span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
						in workflow
					</span>
				) : null}

				<div className="ml-auto flex shrink-0 items-center gap-4">
					{hasTrend ? (
						<div className="hidden h-7 w-20 sm:block">
							<Sparkline bloom="aura" color="blue" data={rule.trend} />
						</div>
					) : null}
					<div className="w-10 text-right">
						<p
							className={cn(
								"font-medium text-sm tabular-nums leading-none",
								rule.matches24h > 0
									? "text-red-600 dark:text-red-400"
									: "text-foreground",
							)}
						>
							{rule.matches24h}
						</p>
						<p className="mt-1 text-[11px] text-muted-foreground">24h</p>
					</div>
					{standalone ? (
						offering ? (
							<button
								className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
								disabled={!canEdit}
								onClick={() => setEnabled(true)}
								type="button"
							>
								enable
							</button>
						) : (
							<Switch
								checked={enabled}
								disabled={!canEdit}
								onCheckedChange={setEnabled}
							/>
						)
					) : null}
				</div>
			</div>

			{/* BODY — the payload. Grows to fill so cards in a row share height
			    and the footer pins to the bottom. */}
			<div className="flex-1 px-4 py-3">
				{body}

				{rule.held && standalone ? (
					<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
						<span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-400">
							update held
						</span>
						<span className="text-muted-foreground">
							{rule.changeNote ? `${rule.changeNote}. ` : ""}your saved settings
							don't carry over. re-confirm to move to the new version.
						</span>
						<button
							aria-pressed={upgradeQueued === true}
							className="font-medium text-primary hover:underline disabled:opacity-50"
							disabled={!canEdit}
							onClick={() => setUpgradeQueued(upgradeQueued !== true)}
							type="button"
						>
							{upgradeQueued === true ? "queued. save to apply" : "re-confirm"}
						</button>
					</div>
				) : null}
			</div>

			{/* FOOTER — subordinate actions, out of the data column */}
			{rule.management === "managed" ? (
				<div className="flex items-center justify-between px-4 pb-2.5">
					{rule.workflowId ? (
						<Link
							className="font-medium text-primary text-xs hover:underline"
							params={{ org, repo, workflowId: rule.workflowId }}
							to="/$org/$repo/workflows/$workflowId"
						>
							edit in workflow →
						</Link>
					) : (
						<span />
					)}
					{showParams ? <RawConfigDisclosure config={rule.config} /> : null}
				</div>
			) : standalone && showParams ? (
				<div className="flex justify-end px-4 pb-2.5">
					<RawConfigDisclosure config={rule.config} />
				</div>
			) : null}
			{rule.source === "custom" && canEdit && onDelete ? (
				rule.blockingWorkflows.length > 0 ? (
					// Referenced by a workflow (enabled or disabled): delete is refused
					// server-side; the button stays visible but disabled, naming the
					// workflows so the reason reads intentional, not broken.
					<div className="flex flex-col items-end gap-1 px-4 pb-2.5 text-xs">
						<button
							className="cursor-not-allowed text-muted-foreground/40"
							disabled
							title="remove this rule from its workflows before deleting"
							type="button"
						>
							delete rule
						</button>
						<span className="text-muted-foreground">
							in use by{" "}
							{rule.blockingWorkflows.map((wf, index) => (
								<span key={wf.id}>
									{index > 0 ? ", " : ""}
									<Link
										className="font-medium text-primary hover:underline"
										params={{ org, repo, workflowId: wf.id }}
										to="/$org/$repo/workflows/$workflowId"
									>
										{wf.name}
									</Link>
								</span>
							))}
						</span>
					</div>
				) : (
					<div className="flex justify-end px-4 pb-2.5">
						<button
							className="text-muted-foreground text-xs hover:text-red-500"
							onClick={() => onDelete(rule.ruleId)}
							type="button"
						>
							delete rule
						</button>
					</div>
				)
			) : null}
		</div>
	);
}
