import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModerationOutcome, ModerationSubject } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { ActionRow } from "@tripwire/ui/layouts";
import { Skeleton } from "@tripwire/ui/skeleton";
import { notify } from "@tripwire/ui/toast";
import { Body, SupportingText } from "@tripwire/ui/typography";
import {
	ModerationOutcomeHelp,
	ModerationOutcomePicker,
} from "#/components/settings/moderation-outcome-picker";
import { SettingsPanel } from "#/components/settings/settings-frame";
import { saveOrgModerationPolicy } from "#/lib/moderation-policy.functions";
import { moderationPolicyQueryOptions } from "#/lib/moderation-policy.query";

export function OrgModerationDefaults({
	org,
	canManage,
}: {
	org: string;
	canManage: boolean;
}) {
	const options = moderationPolicyQueryOptions(org);
	const query = useQuery(options);
	const client = useQueryClient();
	const save = useMutation({
		mutationFn: ({
			subject,
			outcome,
		}: {
			subject: ModerationSubject;
			outcome: ModerationOutcome;
		}) => saveOrgModerationPolicy({ data: { org, subject, outcome } }),
		onSuccess: async (policy) => {
			client.setQueryData(options.queryKey, policy);
			await client.invalidateQueries({ queryKey: options.queryKey });
		},
		onError: () =>
			notify.show(
				{ title: "Couldn’t save the default outcome. Try again." },
				"error",
			),
	});
	const defaults = query.data?.defaults;
	function setOutcome(
		subject: ModerationSubject,
		outcome: ModerationOutcome | "inherit" | null,
	) {
		if (outcome && outcome !== "inherit") save.mutate({ subject, outcome });
	}

	return (
		<SettingsPanel id="moderation-defaults" title="Rule outcomes">
			<SupportingText>
				Default outcomes for standalone rules on GitHub. Repositories and
				individual rules can override them.
			</SupportingText>
			{defaults ? (
				<>
					<div className="grid composition-gap-group sm:grid-cols-2">
						<ModerationOutcomePicker
							disabled={!canManage || save.isPending}
							label="Pull requests"
							onChange={(outcome) => setOutcome("change-request", outcome)}
							value={defaults["change-request"]}
						/>
						<ModerationOutcomePicker
							disabled={!canManage || save.isPending}
							label="Issues"
							onChange={(outcome) => setOutcome("issue", outcome)}
							value={defaults.issue}
						/>
					</div>
					<ModerationOutcomeHelp />
				</>
			) : query.isError ? (
				<ActionRow
					secondary={<Body>Couldn’t load the rule outcomes.</Body>}
					primary={
						<Button
							onAction={() => void query.refetch()}
							size="small"
							variant="secondary"
						>
							Retry
						</Button>
					}
				/>
			) : (
				<output
					data-skeleton-box=""
					aria-label="Loading rule outcomes"
					className="h-12 w-full"
				>
					<Skeleton fill />
				</output>
			)}
		</SettingsPanel>
	);
}
