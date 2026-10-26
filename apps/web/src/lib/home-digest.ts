import {
	type DigestRepo,
	type HomeDigest,
	replayRules,
	ruleDisplayName,
	type Verdict,
} from "@tripwire/contracts";

const VERDICTS: readonly Verdict[] = [
	"block",
	"changes_required",
	"needs_review",
	"pass",
	"close",
];

export function aggregateHomeDigest(
	repos: readonly DigestRepo[],
	from: Date,
	to: Date,
): HomeDigest {
	const totals = new Map<Verdict, number>();
	let caught: HomeDigest["caught"] = null;
	let latestAt = "";
	for (const repo of repos) {
		for (const row of repo.counts) {
			totals.set(row.verdict, (totals.get(row.verdict) ?? 0) + row.count);
		}
		const replay = replayRules(repo.preview, repo.uninstalledRuleIds);
		for (const row of replay?.rows ?? []) {
			const run = repo.latestRuns.find((run) => run.number === row.number);
			if (
				!row.ruleId ||
				run?.verdict !== "pass" ||
				run.createdAt < from.toISOString() ||
				run.createdAt > to.toISOString() ||
				run.createdAt <= latestAt
			) {
				continue;
			}
			latestAt = run.createdAt;
			caught = {
				repoId: repo.id,
				repoName: repo.name,
				number: row.number,
				title: row.title,
				ruleId: row.ruleId,
				ruleName: ruleDisplayName(row.ruleId),
				url: `https://github.com/${repo.fullName}/pull/${row.number}`,
			};
		}
	}
	const counts = VERDICTS.filter(
		(verdict) =>
			(verdict !== "changes_required" && verdict !== "close") ||
			(totals.get(verdict) ?? 0) > 0,
	).map((verdict) => ({ verdict, count: totals.get(verdict) ?? 0 }));
	return {
		from: from.toISOString(),
		to: to.toISOString(),
		total: counts.reduce((sum, row) => sum + row.count, 0),
		repos: repos.map(({ id, name }) => ({ id, name })),
		counts,
		caught,
	};
}
