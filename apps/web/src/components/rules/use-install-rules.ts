import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "#/components/glaze/ui/toast";
import { setRulesEnabled } from "#/lib/rules.functions";
import { rulesQueryKeys } from "#/lib/rules.query";
import { trackEvent } from "#/lib/track";

export function useInstallRules(org: string, repoId: string) {
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<string | null>(null);

	const write = async (ruleIds: string[], enabled: boolean) => {
		try {
			const result = await setRulesEnabled({
				data: { org, repoId, ruleIds, enabled },
			});
			return result && "error" in result ? result.error : null;
		} catch {
			return "Tripwire could not save the change. Try again.";
		} finally {
			await queryClient.invalidateQueries({
				queryKey: rulesQueryKeys.config(org, repoId),
			});
		}
	};

	const install = async (key: string, label: string, ruleIds: string[]) => {
		if (ruleIds.length === 0 || pending !== null) {
			return;
		}
		setPending(key);
		const error = await write(ruleIds, true);
		setPending(null);
		if (error) {
			toast.fail(error);
			return;
		}
		for (const rule of ruleIds) {
			trackEvent("rule_toggled", { rule, enabled: true });
		}
		toast.success(`${label} installed`, {
			action: {
				label: "Undo",
				onClick: async () => {
					const undoError = await write(ruleIds, false);
					if (undoError) {
						toast.fail(undoError);
						return;
					}
					for (const rule of ruleIds) {
						trackEvent("rule_toggled", { rule, enabled: false });
					}
					toast.success(`${label} uninstalled`);
				},
			},
		});
	};

	return { install, pending };
}
