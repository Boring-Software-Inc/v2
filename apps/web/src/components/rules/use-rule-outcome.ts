import { useQueryClient } from "@tanstack/react-query";
import type { RuleOutcomeSetting } from "@tripwire/contracts";
import { useState } from "react";
import { toast } from "#/components/glaze/ui/toast";
import { type RuleConfigView, setRuleOutcome } from "#/lib/rules.functions";
import { rulesQueryKeys } from "#/lib/rules.query";
import { trackEvent } from "#/lib/track";
import { outcomeSavedMessage, sameOutcome } from "./rule-outcome";
import { createSerialWrites } from "./serial-writes";

const SAVE_FAILED = "Tripwire could not save the change. Try again.";

export function useRuleOutcome(org: string, repoId: string) {
	const queryClient = useQueryClient();
	const key = rulesQueryKeys.config(org, repoId);

	const [serial] = useState(createSerialWrites);

	const save = async (
		ruleId: string,
		setting: RuleOutcomeSetting,
	): Promise<string | null> => {
		try {
			const result = await setRuleOutcome({
				data: {
					org,
					repoId,
					ruleId,
					outcome: setting.outcome,
					instruction: setting.instruction,
				},
			});
			return result && "error" in result ? result.error : null;
		} catch {
			return SAVE_FAILED;
		}
	};

	const write = async (
		ruleId: string,
		setting: RuleOutcomeSetting,
	): Promise<string | null> => {
		await queryClient.cancelQueries({ queryKey: key });
		queryClient.setQueryData<RuleConfigView[]>(key, (rules) =>
			rules?.map((rule) =>
				rule.ruleId === ruleId ? { ...rule, outcome: setting } : rule,
			),
		);
		return await serial(
			ruleId,
			() => save(ruleId, setting),
			() => queryClient.invalidateQueries({ queryKey: key }),
		);
	};

	return async (rule: RuleConfigView, next: RuleOutcomeSetting) => {
		const previous = rule.outcome;
		if (sameOutcome(previous, next)) {
			return;
		}
		const error = await write(rule.ruleId, next);
		if (error) {
			toast.fail(error);
			return;
		}
		trackEvent("rule_outcome_set", {
			rule: rule.ruleId,
			outcome: next.outcome,
		});
		toast.success(outcomeSavedMessage(rule.name, previous, next), {
			action: {
				label: "Undo",
				onClick: async () => {
					const undoError = await write(rule.ruleId, previous);
					if (undoError) {
						toast.fail(undoError);
						return;
					}
					trackEvent("rule_outcome_set", {
						rule: rule.ruleId,
						outcome: previous.outcome,
					});
				},
			},
		});
	};
}
