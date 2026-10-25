import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ResponseConfig } from "@tripwire/contracts";
import { saveRepoResponseConfig } from "#/lib/response.functions";
import { responseQueryKeys } from "#/lib/response.query";

const SAVE_FAILED =
	"Changes did not save. Check your connection and save again.";

async function save(org: string, repoId: string, config: ResponseConfig) {
	const result = await saveRepoResponseConfig({
		data: { org, repoId, config },
	}).catch(() => ({ error: SAVE_FAILED }));
	if ("error" in result) {
		throw new Error(result.error);
	}
	return result;
}

export function useSaveResponseConfig(org: string, repoId: string) {
	const queryClient = useQueryClient();
	const queryKey = responseQueryKeys.config(org, repoId);

	return useMutation({
		mutationFn: (config: ResponseConfig) => save(org, repoId, config),
		onMutate: async (config) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData<ResponseConfig>(queryKey);
			queryClient.setQueryData(queryKey, config);
			return { previous };
		},
		onError: (_error, _config, context) => {
			if (context?.previous) {
				queryClient.setQueryData(queryKey, context.previous);
			}
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey }),
	});
}
