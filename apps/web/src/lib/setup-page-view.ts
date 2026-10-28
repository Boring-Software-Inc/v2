import type { QueryClient } from "@tanstack/react-query";
import {
	markResponsesReviewed,
	type RepoSetupState,
} from "#/lib/repo-setup.functions";
import { repoSetupQueryKeys } from "#/lib/repo-setup.query";

export async function completeResponsesStep(
	queryClient: QueryClient,
	org: string,
	repo: string,
): Promise<void> {
	const key = repoSetupQueryKeys.detail(org, repo);
	if (
		queryClient.getQueryData<RepoSetupState | null>(key)?.facts.responsesChosen
	) {
		return;
	}
	try {
		const { changed } = await markResponsesReviewed({ data: { org, repo } });
		if (changed) {
			await queryClient.invalidateQueries({ queryKey: key });
		}
	} catch {}
}
