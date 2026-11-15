import { useQueryClient } from "@tanstack/react-query";
import { notify } from "@tripwire/ui/toast";
import { useState } from "react";
import { homeDigestQueryKeys } from "#/lib/home-digest.query";
import { setRulesEnabled } from "#/lib/rules.functions";
import { rulesQueryKeys } from "#/lib/rules.query";
import { trackEvent } from "#/lib/track";

export interface InstallRulesOptions {
	prepare?: () => Promise<string | null>;
	onDone?: () => void;
}

export function useInstallRules(
	org: string,
	repoId: string,
	options: InstallRulesOptions = {},
) {
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
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: rulesQueryKeys.config(org, repoId),
				}),
				queryClient.invalidateQueries({
					queryKey: homeDigestQueryKeys.all(org),
				}),
			]);
		}
	};

	const install = async (key: string, label: string, ruleIds: string[]) => {
		if (ruleIds.length === 0 || pending !== null) {
			return;
		}
		setPending(key);
		const blocked = options.prepare ? await options.prepare() : null;
		const error = blocked ?? (await write(ruleIds, true));
		setPending(null);
		options.onDone?.();
		if (error) {
			notify.show({ title: error }, "error");
			return;
		}
		for (const rule of ruleIds) {
			trackEvent("rule_toggled", { rule, enabled: true });
		}
		notify.show(
			{
				title: `${label} installed`,
				action: {
					label: "Undo",
					onAction: async () => {
						const undoError = await write(ruleIds, false);
						if (undoError) {
							notify.show({ title: undoError }, "error");
							return;
						}
						for (const rule of ruleIds) {
							trackEvent("rule_toggled", { rule, enabled: false });
						}
						notify.show({ title: `${label} uninstalled` }, "success");
					},
				},
			},
			"success",
		);
	};

	return { install, pending };
}
