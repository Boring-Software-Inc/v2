import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "#/components/ui/switch";
import { type RuleConfigView, saveRuleConfig } from "#/lib/rules.functions";
import { rulesQueryKeys } from "#/lib/rules.query";

export function RuleConfigForm({
	repoId,
	rule,
}: {
	repoId: string;
	rule: RuleConfigView;
}) {
	const queryClient = useQueryClient();
	const [enabled, setEnabled] = useState(rule.enabled);
	const [configText, setConfigText] = useState(
		JSON.stringify(rule.config, null, 2),
	);
	const [parseError, setParseError] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: saveRuleConfig,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: rulesQueryKeys.config(repoId),
			}),
	});

	const save = (nextEnabled: boolean, text: string) => {
		let config: unknown;
		try {
			config = JSON.parse(text);
		} catch {
			setParseError("invalid json");
			return;
		}
		setParseError(null);
		mutation.mutate(
			{
				data: {
					repoId,
					ruleId: rule.ruleId,
					enabled: nextEnabled,
					config: config as never,
				},
			},
			{
				onSuccess: (result) => {
					if (result && "error" in result) {
						setParseError(result.error);
					} else {
						toast(`${rule.name} saved`);
					}
				},
			},
		);
	};

	return (
		<div className="rounded-lg border bg-card px-4 py-3">
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="font-medium text-sm">{rule.name}</span>
						<span className="font-mono text-muted-foreground text-xs">
							{rule.ruleId}@{rule.version}
						</span>
						{rule.managedByWorkflow ? (
							<span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground">
								managed by your workflow
							</span>
						) : null}
					</div>
					<p className="mt-0.5 text-muted-foreground text-xs">{rule.blurb}</p>
				</div>
				<Switch
					checked={enabled}
					onCheckedChange={(next) => {
						setEnabled(next);
						save(next, configText);
					}}
				/>
			</div>
			<textarea
				className="mt-3 w-full rounded-md border bg-surface-1 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
				onBlur={() => save(enabled, configText)}
				onChange={(e) => setConfigText(e.target.value)}
				rows={Math.min(6, configText.split("\n").length)}
				spellCheck={false}
				value={configText}
			/>
			{parseError ? (
				<p className="mt-1 text-red-500 text-xs">{parseError}</p>
			) : null}
		</div>
	);
}
