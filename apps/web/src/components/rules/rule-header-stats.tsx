import { useParams } from "@tanstack/react-router";
import { StatCard } from "#/components/common/stat-card";
import type { RulesHeaderStats } from "#/lib/rules.functions";

function deltaWords(delta: number): string {
	if (delta === 0) {
		return "Same as the day before";
	}
	return `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} on the day before`;
}

export function RuleHeaderStats({
	stats,
}: {
	stats: RulesHeaderStats | undefined;
}) {
	const { org, repo } = useParams({ strict: false });
	const link = org && repo ? { org, repo } : undefined;

	return (
		<section
			aria-label="Rule activity"
			className="grid grid-cols-1 gap-2 sm:grid-cols-3"
		>
			<StatCard label="Active rules" value={stats?.activeRules} />
			<StatCard
				detail={stats ? deltaWords(stats.matches24h.delta) : undefined}
				label="Matches, last 24 hours"
				link={link}
				series={stats?.matches24h.series}
				value={stats?.matches24h.value}
			/>
			<StatCard
				label="Actions taken, last 24 hours"
				link={link ? { ...link, metric: "blocked" } : undefined}
				series={stats?.actioned24h.series}
				value={stats?.actioned24h.value}
			/>
		</section>
	);
}
