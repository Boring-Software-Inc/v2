import { Chart } from "#/components/glaze/ui/chart";
import type { RulesHeaderStats } from "#/lib/rules.functions";

function hourLabel(hoursAgo: number): string {
	return hoursAgo === 0 ? "This hour" : `${hoursAgo}h ago`;
}

function deltaWords(delta: number): string {
	if (delta === 0) {
		return "";
	}
	return `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} on the day before`;
}

export function RuleHeaderStats({ stats }: { stats: RulesHeaderStats }) {
	const matches = stats.matches24h.series;
	const actioned = stats.actioned24h.series;
	const length = Math.max(matches.length, actioned.length);
	const rows = Array.from({ length }, (_, i) => ({
		hour: hourLabel(length - 1 - i),
		matches: matches[i] ?? null,
		actioned: actioned[i] ?? null,
	}));

	return (
		<section aria-label="Rule activity" className="flex flex-col gap-3">
			<p className="type-body text-text-2">
				<span className="text-text-1 tabular-nums">{stats.activeRules}</span>{" "}
				{stats.activeRules === 1 ? "rule" : "rules"} active.{" "}
				<span className="text-text-1 tabular-nums">
					{stats.matches24h.value}
				</span>{" "}
				{stats.matches24h.value === 1 ? "match" : "matches"} in the last 24
				hours{deltaWords(stats.matches24h.delta)}. Tripwire took action{" "}
				<span className="text-text-1 tabular-nums">
					{stats.actioned24h.value}
				</span>{" "}
				{stats.actioned24h.value === 1 ? "time" : "times"}.
			</p>
			<Chart
				config={{
					hour: { label: "Hour" },
					matches: { label: "Matches" },
					actioned: { label: "Actions taken" },
				}}
				data={rows}
				empty="No matches in the last 24 hours"
				height={120}
				label="Matches and actions taken, last 24 hours"
				type="line"
				unit="count"
				xKey="hour"
			/>
		</section>
	);
}
