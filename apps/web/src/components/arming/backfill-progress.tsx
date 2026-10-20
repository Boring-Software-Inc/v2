import { useQuery } from "@tanstack/react-query";
import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "#/components/glaze/ui/progress";
import { orgRepoQueryOptions } from "#/lib/org.query";

export function BackfillProgress({
	org,
	repo: repoName,
	className,
}: {
	org: string;
	repo: string;
	className?: string;
}) {
	const { data: repo } = useQuery({
		...orgRepoQueryOptions(org, repoName),
		refetchInterval: (query) =>
			query.state.data && query.state.data.backfillTotal !== null
				? 2000
				: false,
	});

	if (!repo || repo.backfillTotal === null) {
		return null;
	}
	const done = repo.backfillDone ?? 0;
	const total = repo.backfillTotal;
	return (
		<Progress className={className} max={total} value={done}>
			<ProgressLabel>
				Importing past change requests. This keeps running if you leave the
				page.
			</ProgressLabel>
			<ProgressValue>{() => `${done} of ${total}`}</ProgressValue>
		</Progress>
	);
}
