import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "#/components/glaze/ui/toast";
import type { RuleConfigView } from "#/lib/rules.functions";
import { trackEvent } from "#/lib/track";
import { addRuleException } from "#/lib/workflows.functions";
import { workflowsQueryKeys } from "#/lib/workflows.query";

const OPEN_FAILED = "Tripwire could not open the workflow. Try again.";

export function useAddException(org: string, repo: string, repoId: string) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (rule: RuleConfigView) =>
			addRuleException({ data: { org, repoId, ruleId: rule.ruleId } }),
		onSuccess: (result, rule) => {
			if (!result.ok) {
				toast.fail(result.error);
				return;
			}
			trackEvent("rule_exception_opened", {
				rule: rule.ruleId,
				created: result.created,
			});
			void navigate({
				params: { org, repo, workflowId: result.workflowId },
				to: "/$org/$repo/workflows/$workflowId",
			});
		},
		onError: () => {
			toast.fail(OPEN_FAILED);
		},
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: workflowsQueryKeys.list(org, repoId),
			}),
	});
	return {
		addException: (rule: RuleConfigView) => mutation.mutate(rule),
		pendingRuleId: mutation.isPending ? mutation.variables?.ruleId : undefined,
	};
}
