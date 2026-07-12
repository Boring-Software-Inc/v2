import { DitherStatCard } from "#/components/charts/dither-stat-card";
import type { RulesHeaderStats } from "#/lib/rules.functions";

/**
 * The §9 rules header: 4 stat cards over REAL data. Matches and actioned are
 * genuine 24h time series (dither sparkline); active rules is a config count
 * (no series) and FP rate has no data yet (§6 loop needs reversals) — both
 * render honestly WITHOUT a faked chart or delta.
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
				color="purple"
				delay={90}
				delta={stats.matches24h.delta}
				invertDelta
				label="matches · 24h"
				series={stats.matches24h.series}
				value={String(stats.matches24h.value)}
			/>
			<DitherStatCard
				animate={animate}
				color="orange"
				delay={180}
				delta={stats.actioned24h.delta}
				label="actioned · 24h"
				series={stats.actioned24h.series}
				value={String(stats.actioned24h.value)}
			/>
			<PlainStatCard label="FP rate" value="not enough data" muted />
		</div>
	);
}

/** A stat with no honest time series — a big number or an empty-state line. */
function PlainStatCard({
	label,
	value,
	muted,
}: {
	label: string;
	value: string;
	muted?: boolean;
}) {
	return (
		<div className="overflow-hidden rounded-xl bg-card ring-foreground/15">
			<div className="flex flex-col gap-1.5 px-3.5 pt-3.5 pb-2.5">
				<span className="text-muted-foreground text-xs">{label}</span>
				<span
					className={
						muted
							? "text-muted-foreground text-sm"
							: "font-sans text-2xl text-foreground"
					}
				>
					{value}
				</span>
			</div>
			<div className="h-11" />
		</div>
	);
}
