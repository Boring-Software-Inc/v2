import { DitherStatCard } from "#/components/charts/dither-stat-card";
import type { RulesHeaderStats } from "#/lib/rules.functions";

/**
 * The §9 rules header: 4 stat cards over REAL data. Matches and actioned are
 * genuine 24h time series (dither sparkline); active rules is a config count
 * and FP rate has no data yet (§6 loop needs reversals). Every card renders the
 * chart lane REGARDLESS — a zero window is a flat baseline, not empty-state copy
 * (a chart that says 0 IS zero). Cards sit on `surface-1`, not the card fill.
 */
export function RuleHeaderStats({
	stats,
	animate,
}: {
	stats: RulesHeaderStats;
	animate: boolean;
}) {
	return (
		<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
			<PlainStatCard label="active rules" value={String(stats.activeRules)} />
			<DitherStatCard
				animate={animate}
				className="bg-surface-1"
				color="purple"
				delay={90}
				delta={stats.matches24h.delta}
				goodDirection="down"
				label="matches · 24h"
				series={stats.matches24h.series}
				value={String(stats.matches24h.value)}
			/>
			<DitherStatCard
				animate={animate}
				className="bg-surface-1"
				color="orange"
				delay={180}
				delta={stats.actioned24h.delta}
				label="actioned · 24h"
				series={stats.actioned24h.series}
				value={String(stats.actioned24h.value)}
			/>
			<PlainStatCard label="FP rate" value="0" />
		</div>
	);
}

/** A stat with no time series (a config count). Still renders the chart lane —
 * a flat baseline — so it reads as "zero", uniform with the sparkline cards. */
function PlainStatCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="overflow-hidden rounded-xl bg-surface-1 ring-foreground/15">
			<div className="flex flex-col gap-1.5 px-3.5 pt-3.5 pb-2.5">
				<span className="text-muted-foreground text-xs">{label}</span>
				<span className="font-sans text-2xl text-foreground">{value}</span>
			</div>
			<div className="flex h-11 items-center px-3">
				<div className="h-px w-full bg-foreground/15" />
			</div>
		</div>
	);
}
