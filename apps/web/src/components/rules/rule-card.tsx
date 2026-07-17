import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ruleUiSchema } from "@tripwire/contracts";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkline } from "#/components/charts/dither-kit";
import { ParamSentence } from "#/components/rules-params/param-sentence";
import { RawConfigDisclosure } from "#/components/rules-params/raw-config-disclosure";
import { Switch } from "#/components/ui/switch";
import {
	type RuleConfigView,
	saveRuleConfig,
	upgradeRuleConfig,
} from "#/lib/rules.functions";
import { rulesQueryKeys } from "#/lib/rules.query";
import { cn } from "#/lib/utils";

/**
 * One rule as a header/body/footer card (§9), with per-rule management state
 * (§6, workflow-only execution):
 *
 * - standalone — no workflow enabled: the normal card. Toggle, inline editing,
 *   view raw. Its own config runs.
 * - managed — a node in an enabled workflow: no toggle, values read-only (the
 *   NODE's config, what actually runs), footer "edit in workflow". Held prompt
 *   is suppressed (the workflow node, not the rule_config, drives it).
 * - dormant — a workflow is enabled but doesn't include this rule: values dimmed,
 *   not editable, a plain line that it isn't protecting the repo, and the primary
 *   affordance "add to workflow".
 */
export function RuleCard({
	org,
	repo,
	repoId,
	rule,
	canEdit,
}: {
	/** Org slug from the URL. */
	org: string;
	/** Repo slug from the URL — for the workflow deep-links. */
	repo: string;
	repoId: string;
	rule: RuleConfigView;
	/** Caller is an org admin — gates the inline config editors (§9). */
	canEdit: boolean;
}) {
	const queryClient = useQueryClient();
	const [enabled, setEnabled] = useState(rule.enabled);
	const hasTrend = rule.trend.some((n) => n > 0);
	const standalone = rule.management === "standalone";
	/** An opt-in rule that's off is an OFFER, not a silently-disabled toggle. */
	const offering = rule.optIn && !enabled && standalone;
	const hasParams = (ruleUiSchema(rule.ruleId)?.params.length ?? 0) > 0;
	/** Show the param sentence (not the blurb) — configurable + not an offer. */
	const showParams = hasParams && !offering;

	const mutation = useMutation({
		mutationFn: saveRuleConfig,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: rulesQueryKeys.config(org, repoId),
			}),
	});

	const upgrade = useMutation({
		mutationFn: upgradeRuleConfig,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: rulesQueryKeys.config(org, repoId),
			}),
		onSuccess: (result) => {
			toast(
				result && "error" in result ? result.error : `${rule.name} updated`,
			);
		},
	});

	// One write path (§9): a typed config object straight to the admin-gated
	// mutation — no freeform JSON parsing. Only reachable in standalone state.
	const saveConfig = (nextEnabled: boolean, config: unknown) => {
		mutation.mutate(
			{
				data: {
					org,
					repoId,
					ruleId: rule.ruleId,
					enabled: nextEnabled,
					config: config as never,
				},
			},
			{
				onSuccess: (result) => {
					toast(
						result && "error" in result ? result.error : `${rule.name} saved`,
					);
				},
			},
		);
	};
	const asObject = (c: unknown): Record<string, unknown> =>
		typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};

	const body = showParams ? (
		<ParamSentence
			canEdit={canEdit && standalone}
			config={rule.config}
			onSaveParam={(key, value) =>
				saveConfig(enabled, { ...asObject(rule.config), [key]: value })
			}
			ruleId={rule.ruleId}
		/>
	) : (
		<p className="text-muted-foreground text-xs leading-relaxed">
			{rule.blurb}
		</p>
	);

	return (
		<div className="overflow-hidden rounded-xl border bg-card">
			{/* HEADER — identity + verdict state + activity + toggle */}
			<div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 bg-surface-1 px-4 py-2">
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
				{rule.management === "managed" ? (
					<span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
						in workflow
					</span>
				) : rule.management === "dormant" ? (
					<span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground/70 ring-1 ring-border">
						off
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
								onClick={() => {
									setEnabled(true);
									saveConfig(true, rule.config);
								}}
								type="button"
							>
								enable
							</button>
						) : (
							<Switch
								checked={enabled}
								onCheckedChange={(next) => {
									setEnabled(next);
									saveConfig(next, rule.config);
								}}
							/>
						)
					) : null}
				</div>
			</div>

			{/* BODY — the payload */}
			<div className="px-4 py-3">
				{rule.management === "dormant" ? (
					<div className="flex flex-col gap-2">
						<div className="opacity-50">{body}</div>
						<p className="text-muted-foreground text-xs">
							This rule isn't in your workflow, so it isn't protecting this
							repo.
						</p>
						{rule.workflowId ? (
							<Link
								className="font-medium text-primary text-xs hover:underline"
								params={{ org, repo, workflowId: rule.workflowId }}
								to="/$org/$repo/workflows/$workflowId"
							>
								add to workflow →
							</Link>
						) : null}
					</div>
				) : (
					body
				)}

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
							className="font-medium text-primary hover:underline disabled:opacity-50"
							disabled={upgrade.isPending}
							onClick={() =>
								upgrade.mutate({ data: { org, repoId, ruleId: rule.ruleId } })
							}
							type="button"
						>
							re-confirm
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
		</div>
	);
}
