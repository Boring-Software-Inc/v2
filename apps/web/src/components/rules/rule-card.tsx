import { Link } from "@tanstack/react-router";
import { ruleUiSchema } from "@tripwire/contracts";
import { Sparkline } from "#/components/charts/dither-kit";
import { ParamSentence } from "#/components/rules-params/param-sentence";
import { useSaveQueue, useSaveQueueField } from "#/components/save-queue";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import type { RuleConfigView } from "#/lib/rules.functions";
import { cn } from "#/lib/utils";

/** One chip style for every piece of header metadata — same size, same fill,
 * same ring. Variance here is what made the header read as noise. */
const CHIP =
	"flex items-center gap-1 rounded bg-surface-1 px-1.5 py-px text-[10px] text-muted-foreground ring-1 ring-border";

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
		<div className="flex h-full flex-col gap-1 overflow-hidden rounded-[10px] border border-border bg-surface-2 p-0.5">
			{/* HEADER — two lanes that can't collide: an identity column that
			    truncates, and a fixed rail. Chips get their own row so any number
			    of them can never displace the stat or the toggle (the old
			    single wrapping row broke as soon as a card had three chips).
			    No dither on rules of any source (§9). */}
			<div className="flex items-start gap-3 px-3 pt-2 pb-1.5">
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<span className="truncate font-medium text-sm">{rule.name}</span>
					<div className="flex flex-wrap items-center gap-1.5">
						<span
							className={cn(
								CHIP,
								!(enabled && standalone) && "text-muted-foreground/50",
							)}
						>
							block
						</span>
						{rule.source === "custom" ? (
							<span className={CHIP}>custom</span>
						) : null}
						{/* Severity (how much a failure weighs) — a dot, not a filled
						    pill, so it stays scannable without out-shouting the name. */}
						{rule.severity ? (
							<span className={CHIP}>
								<span
									className={cn(
										"size-[5px] shrink-0 rounded-full",
										rule.severity === "high"
											? "bg-red-500"
											: rule.severity === "medium"
												? "bg-amber-500"
												: "bg-muted-foreground",
									)}
								/>
								{rule.severity}
							</span>
						) : null}
						{rule.management === "managed" ? (
							<span className={CHIP}>in workflow</span>
						) : null}
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-3">
					{hasTrend ? (
						<div className="hidden h-7 w-20 sm:block">
							<Sparkline bloom="aura" color="blue" data={rule.trend} />
						</div>
					) : null}
					<div className="flex w-8 flex-col items-end">
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
						<p className="mt-1 text-[10px] text-muted-foreground leading-none">
							24h
						</p>
					</div>
					{standalone ? (
						offering ? (
							<Button
								className="h-auto px-2.5 py-1 text-xs"
								disabled={!canEdit}
								onClick={() => setEnabled(true)}
							>
								enable
							</Button>
						) : (
							<Switch
								aria-label={`${enabled ? "disable" : "enable"} ${rule.name}`}
								checked={enabled}
								disabled={!canEdit}
								onCheckedChange={setEnabled}
								tone="accent"
							/>
						)
					) : null}
				</div>
			</div>

			{/* BODY — the payload, in the recessed well the design puts it in.
			    Grows to fill so cards in a row share height and the subordinate
			    actions pin to the bottom of the well. */}
			<div className="flex flex-1 flex-col rounded-md border border-border bg-surface-1 px-2 py-1">
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
						<Button
							aria-pressed={upgradeQueued === true}
							className="h-auto p-0 font-medium text-foreground text-xs hover:underline"
							disabled={!canEdit}
							onClick={() => setUpgradeQueued(upgradeQueued !== true)}
							variant="ghost"
						>
							{upgradeQueued === true ? "queued. save to apply" : "re-confirm"}
						</Button>
					</div>
				) : null}

				{/* Subordinate actions sit inside the well, per the design */}
				{rule.management === "managed" && rule.workflowId ? (
					<div className="mt-2 flex items-center justify-between">
						<Link
							className="font-medium text-foreground text-xs hover:underline"
							params={{ org, repo, workflowId: rule.workflowId }}
							to="/$org/$repo/workflows/$workflowId"
						>
							edit in workflow →
						</Link>
					</div>
				) : null}

				{/* Delete shares the same action lane rather than floating below the
				    well, so every card's actions sit on one line. */}
				{rule.source === "custom" && canEdit && onDelete ? (
					rule.blockingWorkflows.length > 0 ? (
						// Referenced by a workflow (enabled or disabled): delete is refused
						// server-side; the button stays visible but disabled, naming the
						// workflows so the reason reads intentional, not broken.
						<div className="mt-2 flex flex-col items-end gap-1 text-xs">
							<Button
								className="h-auto cursor-not-allowed p-0 text-[11px] text-muted-foreground/40"
								disabled
								title="remove this rule from its workflows before deleting"
								variant="ghost"
							>
								delete
							</Button>
							<span className="text-muted-foreground">
								in use by{" "}
								{rule.blockingWorkflows.map((wf, index) => (
									<span key={wf.id}>
										{index > 0 ? ", " : ""}
										<Link
											className="font-medium text-foreground hover:underline"
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
						<div className="mt-2 flex justify-end">
							<Button
								className="h-auto p-0 text-[11px] text-muted-foreground hover:text-destructive"
								onClick={() => onDelete(rule.ruleId)}
								variant="ghost"
							>
								delete
							</Button>
						</div>
					)
				) : null}
			</div>
		</div>
	);
}
