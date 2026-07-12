import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkline } from "#/components/charts/dither-kit";
import { Switch } from "#/components/ui/switch";
import { type RuleConfigView, saveRuleConfig } from "#/lib/rules.functions";
import { rulesQueryKeys } from "#/lib/rules.query";

/**
 * One rule over real data (§9): id@version chip, target chip, action summary,
 * the ACTUAL execution toggle (or the "managed by your workflow" tag when a
 * saved workflow owns evaluation), 24h match count + sparkline, and the JSON
 * config editor (per-field editing is a later session).
 */
export function RuleCard({
	repoId,
	rule,
}: {
	repoId: string;
	rule: RuleConfigView;
}) {
	const queryClient = useQueryClient();
	const [enabled, setEnabled] = useState(rule.enabled);
	const [configText, setConfigText] = useState(
		JSON.stringify(rule.config, null, 2),
	);
	const [parseError, setParseError] = useState<string | null>(null);
	const hasTrend = rule.trend.some((n) => n > 0);
	/** An opt-in rule that's off is an OFFER, not a silently-disabled toggle. */
	const offering = rule.optIn && !enabled && !rule.managedByWorkflow;

	const mutation = useMutation({
		mutationFn: saveRuleConfig,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: rulesQueryKeys.config(repoId),
			}),
	});

	const save = (nextEnabled: boolean, text: string) => {
		let config: unknown;
		try {
			config = JSON.parse(text);
		} catch {
			setParseError("invalid json");
			return;
		}
		setParseError(null);
		mutation.mutate(
			{
				data: {
					repoId,
					ruleId: rule.ruleId,
					enabled: nextEnabled,
					config: config as never,
				},
			},
			{
				onSuccess: (result) => {
					if (result && "error" in result) {
						setParseError(result.error);
					} else {
						toast(`${rule.name} saved`);
					}
				},
			},
		);
	};

	return (
		<div className="rounded-lg border bg-card px-4 py-3">
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline gap-2">
						<span className="font-medium text-sm">{rule.name}</span>
						<span className="font-mono text-muted-foreground text-xs">
							{rule.ruleId}@{rule.version}
						</span>
						<span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground">
							change request
						</span>
					</div>
					<p className="mt-0.5 text-muted-foreground text-xs">
						block · {rule.blurb}
					</p>
				</div>

				<div className="flex shrink-0 items-center gap-5">
					{hasTrend ? (
						<div className="hidden h-7 w-20 md:block">
							<Sparkline bloom="aura" color="blue" data={rule.trend} />
						</div>
					) : null}
					<div className="w-10 text-right">
						<p className="font-medium text-sm tabular-nums leading-none">
							{rule.matches24h}
						</p>
						<p className="mt-1 text-[11px] text-muted-foreground">24h</p>
					</div>
					{rule.managedByWorkflow ? (
						<span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground">
							managed by your workflow
						</span>
					) : offering ? (
						<button
							className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
							onClick={() => {
								setEnabled(true);
								save(true, configText);
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
								save(next, configText);
							}}
						/>
					)}
				</div>
			</div>

			{offering ? null : (
				<textarea
					className="mt-3 w-full rounded-md border bg-surface-1 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
					disabled={rule.managedByWorkflow}
					onBlur={() => save(enabled, configText)}
					onChange={(e) => setConfigText(e.target.value)}
					rows={Math.min(6, configText.split("\n").length)}
					spellCheck={false}
					value={configText}
				/>
			)}
			{parseError ? (
				<p className="mt-1 text-red-500 text-xs">{parseError}</p>
			) : null}
		</div>
	);
}
